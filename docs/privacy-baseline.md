# Privacy baseline: what one deal reveals to a stranger

Measured on 2026-11-14 against the live service (operators `https://api.crow.direct` and `https://api2.crow.direct`, Ethereum Sepolia, the phase-one contracts), on the deals of the live rehearsal of 2026-11-13 (`docs/tasks/T-399-pilot-rehearsal-live.md`). This is a dated record: its numbers are measurements at that time. Task: `docs/tasks/T-416-privacy-baseline.md`; roadmap row N30.

## The answer

**Every deal on the live service is public today, and a stranger learns almost all of it.** The live service judges only `disclosure.level: "public"`: Crow's adjudicators decline `private` and `judgment` offers, so those stay unfunded (`site/ref/adjudicators.txt`, "Private deals"). All 29 deals on the operators on 2026-11-14 were public (measured).

From one public deal, with no key and no credential, a stranger reads:

- **the whole terms:** the scope description, the commit and file names, every check, the price, the fees, the deadlines, the three adjudicators, both signing keys, the payment address and the payout address (measured);
- **the encrypted report's exact size, its arrival time and its SHA-256** (measured). The SHA-256 lets a stranger confirm a guessed copy: from the public sample report and each deal's public scope, this task rebuilt the exact plaintext of 5 of the 6 deliveries it tried (measured). The chain alone is enough, since the delivery's calldata carries keccak256 of that SHA-256 (measured, case 8);
- **with a rubric, the report's findings:** the judges' notes in the public judgment record quote file names, line numbers, bug classes and severities (measured, case 3);
- **every other deal of the same signing key:** `GET /v1/commitments?party=<address>` lists them, 15 for the rehearsal's seller key (measured).

The chain alone shows the amounts, the token, the time of each step and all four party addresses together in each step's calldata, so it ties a payment address to its signing key and a payout address to the seller's key (measured, case 8). It carries no terms text (measured). At every level, the operators' state read `GET /v1/commitments/<id>` also serves the payment and payout addresses with their token balances (measured at `public`, case 8; inferred at the others).

The encryption holds: no stranger opened a report (measured, the envelopes are sealed to the adjudicators and the buyer). What it does not hide is the size, the timing and the fingerprint.

## How it was measured

- **Operators:** every public GET route that `GET /v1/openapi.json` lists, for eight rehearsal deals: the first-hour deal and cases 1, 3, 4, 5, 8, 9 and 10. Both operators answered byte for byte the same (measured).
- **Chain:** the public RPC `https://ethereum-sepolia-rpc.publicnode.com`: case 8's three transactions and receipts, and the token's Transfer logs for the buyers' payment addresses.
- **No deal was created and nothing on the live service changed.** Scratch outputs are in `reports/scratch/t-416/` (not committed).
- **No `private` or `judgment` deal exists on the live service,** so those rows are inferred from the code at `origin/main` `b9e33a9`: `apps/operator/src/server.ts` (outsider reads, `projectEvent`, the judgment route) and `packages/core/src/private.ts` (`projectionOf`).

### The sample deal, step by step

The first-hour deal, `0x74a7504281a1b47f4865df680d13d0867380908578075f58f373d755d0c3fa34`, Released. Times from its public events (measured, `GET /v1/commitments/<id>/events`).

| Step | Time (UTC) | What a stranger sees |
| --- | --- | --- |
| Offered | 08:16:23 | The full terms, signed by the seller key `0x0d65…01e1` |
| Adjudicator accepted | 08:16:26 | The primary `0xa909…23ed`, its fee 1.00 tUSDC, its seed commitment |
| Agreed and funded | 08:16:48 | 551.00 tUSDC from `0xe781…1440`; transaction `0xcbed74a9…925a` |
| Delivered | 08:17:00 | `plaintextSha256` `c107902d…1674`, ciphertext 5,114 bytes, its download link |
| Decided and released | 08:17:12 | Accept; 550.00 tUSDC to `0x0d65…01e1`, 1.00 tUSDC to `0xa909…23ed` |

The report arrived 12 s after funding, which tells a stranger the work was ready before the deal (inferred). The buyer's tokens were minted to `0xe781…1440` one block before funding, for exactly 551.00 tUSDC, by the faucet's sender `0x6011…f555` (measured, block 12124714).

## What each observer learns

"Stranger" means anyone with no key: chain alone, the operators' public reads alone, and the two together. The counterparty, the adjudicator and the operator columns list what each learns beyond a stranger. M is measured on a rehearsal deal; I is inferred from the code or the docs.

### Level `public` (the only level the live service judges)

| What | Stranger, chain alone | Stranger, operators alone | Stranger, both | Counterparty, beyond | Adjudicator, beyond | Operator, beyond |
| --- | --- | --- | --- | --- | --- | --- |
| Signing keys, payment and payout addresses | All four in each step's calldata (M, case 8) | In `/terms` (M) | The same, and one funding graph | Nothing more | Nothing more | Nothing more |
| Link from payment address to buyer's signing key | Yes, both in one calldata (M, case 8: `0x3281…e6e5` pays, `0xb6ea…91ca` signs) | Yes, `buyerPaymentAddress` beside `buyer` (M) | Yes | Nothing more | Nothing more | Nothing more |
| Link from payout address to seller's signing key | Yes (M, case 8: `0x5f1c…9aaa` paid for `0x0d65…01e1`) | Yes (M) | Yes | Nothing more | Nothing more | Nothing more |
| Link between two deals of one party | Same address in calldata and Transfer logs (M). On the demo the faucet `0x6011…f555` mints to a deal's seller key and then its buyer key on consecutive nonces, which pairs them (M, nonces 86 and 87) | `GET /v1/commitments?party=` lists all of one key's deals: 15 for `0x0d65…01e1` (M). `GET /v1/commitments?limit=100` lists every deal with no filter (M) | Yes | Nothing more | Nothing more | Faucet grants and requests by client IP tie fresh keys of one client together (I, `demo.faucet.perClientPerWindow`) |
| Amounts, token, fees | Transfer logs and calldata (M) | `/terms`, events (M) | Yes | Nothing more | Nothing more | Nothing more |
| Timing of every step | Block times (M) | Event times to the second (M) | Yes | Nothing more | Nothing more | Request times, client IP, who read which deal (I, ADR-0024 §1) |
| Which contract calls | Fund, deliver, decide or reclaim: selectors on HoldbackRules (M) | Event types (M) | Yes | Nothing more | Nothing more | Nothing more |
| Scope description, commit, file names | Hashes only (M: no text found in calldata) | In full (M). The rehearsal's commit `0180a39f…2f32` resolves in the public repository (M) | In full | Nothing more | Nothing more | Nothing more |
| Checks and rubric | Hashes only (M) | In full (M) | In full | Nothing more | Nothing more | Nothing more |
| The report's content | Nothing | Nothing directly (M: ciphertext only) | Nothing directly | The buyer reads it once paid (M, T-399) | Reads it (M: its record checked the plaintext hash) | Nothing (I: holds ciphertext and sealed envelopes) |
| The report's size | Nothing | Exact: `intake.bytes` in the record, and ciphertext bytes minus 28 (M: 5,114 − 28 = 5,086) | Exact | Nothing more | Nothing more | Nothing more |
| The report's fingerprint | keccak256 of `plaintextSha256` in the delivery's calldata (M, case 8), bound by `deliveryHash` in its log: confirms a guessed report and shows equal reports, from the chain alone | `plaintextSha256` in the delivery event (M) | Confirms a guessed report: 5 of 6 rebuilt exactly (M); equal reports show as equal (M: cases 1, 2 and 3; the first-hour deal and case 10; case 4's two runs). If one of them was judged with a rubric, its public notes reveal the others' findings (M: cases 1 and 2 were checks only, case 3 quotes the same report) | Nothing more | Nothing more | Nothing more |
| Checks' results | Accept or reject (M) | Each check's pass or fail with a reason drawn from the report (M, case 4: "/filesReviewed: fewer than 2 items") | Yes | Nothing more | Nothing more | Nothing more |
| Rubric judges' notes | Nothing | Scores, evidence and rationale quoting findings: file names, line numbers, severities, bug classes (M, case 3) | Yes | Nothing more | Nothing more | Nothing more |
| Who else reads the report | Nothing | The record names the judges' model families, Claude and DeepSeek; the second provider shows only as `openai-compatible` (M, case 3) | Yes | Nothing more | Sends the report to two model providers in a rubric deal (M); none in a checks-only deal (M, first-hour deal: `ran: false`) | Nothing more |
| The company behind a key | Nothing | `GET /v1/agents/<address>` names the mandate's principal, its issue time, roles and caps (M). On the demo every key shares the demo's principal `0x44ec…1e32`, so it names no company (M); in a partner's own club it would, and grouping by principal would relink every fresh key of one company (I). The first-hour buyer's mandate was issued 11 s after the offer, so the key was made for the deal (M) | The same | Nothing more | Nothing more | Nothing more |
| Money addresses' balances | `balanceOf` on the token (M) | The state read `GET /v1/commitments/<id>` lists the payment and payout addresses with their current token balances, income from other deals included (M, case 8: `0x3281…e6e5` at 0, `0x5f1c…9aaa` at 1,100.00 tUSDC; the first-hour seller at 1,650.000001 tUSDC) | Yes | Nothing more | Nothing more | Nothing more |
| Gas payer | The operators' relayers pay; the parties' addresses send no transaction (M: nonce 0) | Relayer addresses in events (M) | Yes | Nothing more | Nothing more | Nothing more |

### Level `judgment` (accepted by the operators, not judged on the live service)

No live deal exists, so every cell is inferred (I) from the code and ADR-0024.

| What | Stranger, chain alone | Stranger, operators alone | Stranger, both | Counterparty, beyond | Adjudicator, beyond | Operator, beyond |
| --- | --- | --- | --- | --- | --- | --- |
| Keys and addresses | As at `public`: per-deal keys are fresh, so they link to nothing else (I) | The settlement projection: per-deal buyer and seller, price, adjudicators, deadlines (I, `projectionOf`) | As at `public` | The `Delegation` ties the per-deal key to the long-term agent key and its principal (I, ADR-0024 §7) | The same `Delegation` (I) | Nothing more (I) |
| Payment and payout addresses | In calldata, beside the per-deal keys (I: the contracts take the same view) | Not in `/terms`' projection, but the state read `GET /v1/commitments/<id>` serves both with their balances: it runs before any reader check (I, `server.ts` state route; `packages/settlement/evm/evm-settlement.ts`) | Yes (I) | Nothing more | Nothing more | Nothing more |
| Scope, checks, rubric | Hashes only (I) | Hashes until published. By design the acceptance (checks and rubric) is published at this level (`docs/architecture.md`), but the operators serve it only after a co-signed `Publish` (I, `server.ts`) | The same | Reads both bodies (I) | Reads both bodies (I) | Ciphertext only (I) |
| The report's size and fingerprint | keccak256 of `plaintextSha256` in the delivery's calldata: confirms a guessed report from the chain alone (I, `contracts/src/HoldbackTypes.sol`, `Delivery`) | `plaintextSha256` and ciphertext bytes stay in the delivery event: `projectEvent` changes only the offer (I, `server.ts`) | Confirms a guessed report, as at `public` (I) | Nothing more | Nothing more | Nothing more |
| Judgment record and judges' notes | Accept or reject (I) | The full record, as at `public`: the judgment route refuses outsiders only at `private` (I, `server.ts`) | The same | Nothing more | Nothing more | Nothing more |

### Level `private` (accepted by the operators, not judged on the live service)

All inferred (I).

| What | Stranger, chain alone | Stranger, operators alone | Stranger, both | Counterparty, beyond | Adjudicator, beyond | Operator, beyond |
| --- | --- | --- | --- | --- | --- | --- |
| Keys and addresses | As at `judgment` (I) | The projection, and the state read's payment and payout addresses with balances, as at `judgment` (I) | As at `judgment` | The `Delegation` (I) | The `Delegation` (I) | Nothing more |
| Scope, checks, rubric | Hashes only (I) | Hashes only; the salts stop a guess of a template body (I, ADR-0024 §2) | Hashes only | Reads both bodies (I) | Reads both bodies (I) | Ciphertext and its sizes (I) |
| The report's size and fingerprint | As at `judgment`, from the chain alone (I) | `plaintextSha256` and ciphertext bytes, as at `judgment` (I) | Confirms a guessed report (I) | Nothing more | Nothing more | Nothing more |
| Judgment record | Accept or reject (I) | 401 `unauthorized` without a `ReadToken` (I, `server.ts`) | Accept or reject | Reads it (I) | Wrote it | Nothing (I) |

## What the encrypted delivery hides, and what it does not

- **Hides the content.** The report is AES-256-GCM ciphertext under a fresh key, sealed to the primary adjudicator and to the buyer once paid (measured: `GET /v1/ciphertext/<sha256>` serves 5,114 bytes of ciphertext to anyone; the envelopes in `key.released` events are sealed).
- **Does not hide the exact size.** The ciphertext is the plaintext plus 28 bytes, and the judgment record states `intake.bytes` (measured).
- **Does not hide the timing.** The delivery event and block time show when the report arrived, and how long after funding (measured: 12 s for the first-hour deal).
- **Does not hide the fingerprint.** `plaintextSha256` is public in the delivery event, and the delivery's calldata carries its keccak256 (measured, case 8), so the chain alone confirms a guess. Anyone who can guess the report can confirm the guess: a short "no findings" report in the format the checks spell out is guessable (inferred).
- **Does not protect a later leak of the buyer's key.** The decision's calldata carries the buyer's sealed envelope (measured, transaction `0x3a35c4b3…`), and anyone can download the ciphertext, so whoever later gets the buyer's x25519 secret can open the report from public data (inferred). Use a fresh x25519 key per deal and discard it after opening the report.
- **Does not hide the attempt count or the format.** The `attempt` number is in the delivery event, and the format as `intake.mime` in the judgment record (measured).

## Choices a party has today to disclose less

| Choice | What it hides | What it costs | Status |
| --- | --- | --- | --- |
| A fresh signing key for each deal | The listing of a party's other deals by address, and the same address across deals | One mandate per key; on the demo the faucet grants it. In a club of its own, the mandate's principal still relinks the keys; only per-deal keys under a `Delegation` (`private`) break that (I) | Available (measured: each rehearsal buyer used a fresh key; the seller did not) |
| A payment address apart from the signing key, and a payout address apart from the seller's key | Keeps the money keys off the signing machine | Hides nothing from a stranger: both addresses appear beside the key in the terms and in calldata (measured, case 8). Use fresh addresses too | Available |
| A fresh payment address funded from a source not tied to the company | The company's treasury in the funding graph | An extra transfer; ADR-0024 residual 11 | Available |
| Checks only, no rubric | The judges' notes that quote the report; no model provider reads it | No judgment on quality, only on the checks. It does not help if the same report is judged with a rubric in another deal: equal hashes link them (measured, cases 1 to 3) | Available (measured: the first-hour deal's record shows `ran: false` and no notes) |
| Checks that do not name the seller's own report fields | Recognition of the seller's product from its field names | The seller converts its own format to the public template before delivery (`fixtures/data/audit-report/seller-shape-*.mapping.json`) | Available (measured: the rehearsal used the public template) |
| A scope written without the commit and file names | The buyer's codebase | The `scope` and `coverage` checks then cannot pin the commit and the files; the buyer carries that burden (D28) | Available |
| A random field in the report | Confirmation of a guessed report, and equality between deals | The checks must allow the extra field; the public template's `report` check sets `additionalProperties: false`, so it refuses one (measured) | Available only with checks that allow it |
| Padding the report and spacing its delivery | The exact size and the time spent | A larger report; a later delivery | Available |
| A more private level (`judgment` or `private`) | The bodies, until published; at `private` also the judgment record | Crow's adjudicators decline it, so the deal cannot be funded | **Not available on the live service** |

## Leaks no choice closes today, most serious first

1. **High · The scope and the checks are public for every deal that settles.** The live service judges only `public` deals, so the description, the commit, the file names and the checks are public reads (measured). For a security review, the commit identifies the codebase when it is public (measured, the rehearsal's commit resolves in the public repository). **Smallest change:** Crow's adjudicators open sealed terms, the adjudicator slice of private deals (T-207, now deferred to Phase 8). **Lane:** judgment and operator. This baseline recommends that T-207's adjudicator slice no longer stays deferred, if a partner needs its scope kept from strangers; that is Rafa's decision.
2. **High · The judges' notes in a rubric deal quote the report publicly.** At `public`, and by the code at `judgment` too, the judgment record carries each judge's evidence and rationale, which name file names, line numbers, severities and bug classes (measured, case 3). A Critical finding's location is then public before the buyer fixes it. Choosing checks only avoids it, but no choice closes it for a deal that needs a rubric, nor for a checks-only deal whose report is judged with a rubric elsewhere (measured, cases 1 to 3). **Smallest change:** the adjudicator keeps scores and the outcome in the public record and seals each judge's evidence and rationale to the parties. This extends ADR-0024 §2's sealed record, which today covers only `private`, so it needs an ADR. **Lane:** judgment (`apps/adjudicator`).
3. **Medium · The report's SHA-256 confirms a guessed report and links equal ones.** `plaintextSha256` is public in the delivery event at every level (measured at `public`; inferred at the others), and the delivery's calldata carries its keccak256 (measured), so hiding it at the operators would not close this. With the public template no salt is possible. **Smallest change:** an optional `salt` field of 32 random bytes in the public audit template's report schema, which the seller adapter fills; later, a spec change that hashes a salt carried in the content envelope with the plaintext. **Lane:** the seller adapter and its audit template (T-407's lane); the spec change is kind 6.
4. **Medium · The chain ties each payment and payout address to the deal's signing keys.** Every step's calldata carries the settlement view with all four addresses (measured, case 8), and the operators' state read serves the money addresses with their balances at every level (measured at `public`). Fresh keys and fresh addresses per deal make the link harmless; nothing removes it. **Smallest change:** none in phase one, since `contracts/src/` is frozen for the pilot; a later contract could take a commitment to the addresses. **Lane:** contracts, after the pilot.
5. **Low · In a club of its own, the mandate's principal relinks a company's fresh keys.** `GET /v1/agents/<address>` serves each key's mandate with its principal, issue time and caps (measured), and `GET /v1/commitments` lists every deal (measured). On the demo all keys share one principal, so this names no company (measured); in a partner's own club it would list one company's deals (inferred). **Smallest change:** per-deal keys under a `Delegation`, shown only to the counterparty and the adjudicator (ADR-0024 §7), which comes with T-207's slices. **Lane:** operator and core.
6. **Low · The operator sees each client's IP address, timing and reads.** Inherent to relaying (ADR-0024 §1, residual). On the demo the faucet also groups the keys one client asks for (inferred). Calling the contracts directly avoids the operator for the steps after the offer, but the offer and the agreement pass through an operator (inferred). **Smallest change:** none; a stated limit. **Lane:** operator.

## What a design partner should be told before its first deal

1. Every deal on Crow's live service is public: anyone can read its terms, including the scope, the commit, the file names and the checks.
2. The report is encrypted, and only the buyer, once it has paid, and Crow's adjudicator can open it; anyone still sees its exact size, when it arrived, and a fingerprint that confirms a guessed copy.
3. If the terms carry a rubric, the judges' public notes quote the report's findings, and two model providers read the report; choose checks only, and never send the same report to a deal that has a rubric.
4. The chain shows the amounts, the time of each step, and ties each payment and payout address to the deal's signing key; use a fresh key and fresh addresses for each deal.
5. Leave out of the terms any name you need hidden, and add a random field to the report if your checks allow one; sealed terms are not available on the live service yet.

## What `site/ref/limits.txt` promised, against what was measured

| The guide said | Measured | Change |
| --- | --- | --- |
| "At `disclosure.level: "public"`, terms, amounts, addresses and events are public reads on every operator" | True (measured) | None |
| "The work itself is always private: … only the adjudicators and the buyer, once it has paid, can open it" | The content stays sealed, but its size, timing and SHA-256 are public, and a rubric deal's public record quotes it (measured) | Corrected |
| "Private deals are … not judged here yet" | True: all 29 live deals are public (measured) | None |
| "the addresses, amounts, deadlines and adjudicators a deal names are public on Sepolia …; only the work is private" | The addresses, amounts, deadlines and adjudicators are on chain (measured); "only the work is private" is wrong for the same reasons | Corrected |
| Etherscan "does not show what comes before funding … which the operators hold until the funding carries them on chain" | True: the funding call carries the settlement view and the signatures (measured, case 8) | None |
