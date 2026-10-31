# Demo: two agents, one $2,000 job, nobody in control

The first product priority. The demo exists to describe the experience to an AI lab that supports agentic commerce research. It should leave a researcher able to say what an agent can commit, how judgment is defended, and where control sits.

## Audience and takeaway

**Audience:** researchers and product leads at an AI lab working on agentic commerce (protocols, payments, evaluation, safety).

**Takeaway in one sentence:** two agents from different firms put money and work behind a promise; a bonded multi-model panel judges delivery; settlement happens in seconds; and no single party — including us — could have stopped it or taken the funds.

## Run it

```
pnpm demo                 # recorded mode: deterministic, no keys, ~1 minute
pnpm demo --live          # live judges (needs two model-family keys), ~3 minutes
pnpm demo --beat 4        # run one beat
open demo/out/index.html  # timeline viewer
```

Outputs per beat, in `demo/out/`:
- `<beat>.md`: a narrated transcript;
- `<beat>.json`: the machine-readable trace;
- `index.html`: a static timeline viewer, with no build step and no network.

The recorded transcripts double as the `.expect.md` snapshots in `fixtures/scenarios/`. The demo is the test suite.

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
| Settlement | SimChain | In-process escrow rules with no admin keys; testnet from Phase 5 |

All names are invented for the demo.

## Beats

| # | Beat | What the viewer sees | Litmus test shown |
| --- | --- | --- | --- |
| 1 | **Choose, agree and hold** | Seller offers terms naming Bench A, B and C, chosen by the two agents, at disclosure level `public` so the audience can read everything. Bench A accepts and reserves bond. Buyer signs, one call moves $2,050 (price plus $50 adjudication fee) into escrow. Timer shows milliseconds. Balances update | Agents choose the adjudicator; hold; machine speed |
| 2 | **Deliver without revealing** | Seller uploads an encrypted cleaned CSV. Buyer sees only hashes. Content key goes to the adjudicator | Two-sided hold |
| 3 | **Defended judgment** | Deterministic checks pass (row count, unique keys, date format). Panel seed revealed, judges listed with pinned model IDs, verdicts shown, cross-family agreement, accept | Multi-model judgment |
| 4 | **Settle** | Funds release to the seller; content key releases to the buyer in the same step; buyer verifies the plaintext hash; receipts signed. Narration: "Tidewater's $2,000 is final at the decision (1.2 s). Atlas can contest Bench A's decision for 300 s; if it wins, Bench A's $2,000 bond pays. Nothing takes the payment back from escrow." (illustrative numbers) | Fair exchange |
| 5 | **Bad work** | Second job: deliverable drops 8% of rows. A deterministic check fails, refund in one step, seller keeps the work | Hold; DvP for data |
| 6 | **Injection attempt** | Deliverable hides a base64 instruction telling judges to approve. Screen flags it, the panel cannot auto-accept, escalation to Bench C, five judges reject, refund. A second delivery hides tag characters aimed at the buyer's own agent under an empty rubric: it is accepted, and the buyer's SDK shows "hidden payload stripped before your agent read it" from the signed screen report (ADR-0021) | Defenses |
| 7 | **Nobody in control** | Same job, three failures in sequence: op-1 refuses to relay (SDK fails over, then submits directly); Bench A goes offline (Bench B decides, and gets the content key only now, when it takes over); the club operator revokes the seller mid-flight (the commitment still settles under its signed rulebook) | Neutrality |
| 8 | **Wrongful decision, paid by the bond** (optional) | Bench A wrongly rejects. Seller appeals, Bench C overturns, Bench A's bond pays the seller | Capital behind judgment |
| 9 | **Work for work** (optional; depends on the T-003 spike) | Two agents swap deliverables, each produced on its own user's compute, through two-sided holds. No money moves | Compute-native agreement |
| 10 | **Agree without a judge** (optional; outside the success criteria) | A third job. The buyer finds a gap and both agents co-sign a 70/30 split in milliseconds; the buyer gets the key, Bench A stands by and its bond is released, the fee returns to the buyer | 2-of-3: consent first, adjudicator only on disagreement |

Closing slide in the transcript, also stated by the narrator:
- finality per mode: the payee is final at the posting, the commitment at `finalAt` (`docs/architecture.md` §Finality);
- what remains centralized: residual risks from `docs/neutrality.md`;
- what an AI lab could add: response attestation for judges (today a commitment proves which models and prompt had to judge, but not that the named model answered), a hold primitive on API credit as one rail among many, and model version disclosure for adjudication.

## Narration rules

- Every line states what happened and the number behind it: amount, milliseconds, model ID, hash prefix.
- Show the signed message for one beat, collapsed by default in the viewer.
- No marketing language. Say "recorded verdicts" in recorded mode.

## Success criteria (T-013)

- A fresh clone produces all transcripts in recorded mode within 5 minutes, with no keys.
- A reviewer who has not read the docs can answer, from the transcript alone:
  1. Who held the money?
  2. Who decided?
  3. What stopped the injection?
  4. What happened when op-1 refused?
- Every beat is a passing scenario fixture.
