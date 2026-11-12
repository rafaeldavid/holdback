# The phase-one contracts before the freeze: the second-family review (package R11, review 2)

Date: 2026-11-12. Task: [T-388](../tasks/T-388-reviews-r11.md). Reader: DeepSeek `deepseek-v4-pro`, through its API, run by Rafa from his own shell. Checker: one Claude session (Fable 5.2), which also wrote the first review, [`2026-11-12-phase-one-whole-diff-review.md`](2026-11-12-phase-one-whole-diff-review.md). Subject: `contracts/src` of `contracts-audit-ready`, the vendored escrow, collectors and signature library it relies on, and `examples/buyer-signer.ts`. The model read the code at commit `c629d06c`; the commit named for the freeze, `0180a39f`, differs from it in comments only (the first review, section 2), and the model read those comments at `0180a39f` as its last question.

Labels: **measured**, **documented**, **inferred**, **guessed**. `R:` is `contracts/src/HoldbackRules.sol`, `T:` is `HoldbackTypes.sol`, `E:` is the vendored `AuthCaptureEscrow.sol`. "Question 6, C4" is claim C4 of the model's answer to question 6.

## 1. Summary

**The second model found no Critical or High defect that holds.** It rated three scenarios High; each fails against the code or the token (section 4.1).

**It confirmed two findings of the first review without seeing them, and added one.**

1. **Confirmed, Medium:** a call that carries the buyer's key publishes it in its calldata even when the call reverts (the first review's M-1). The model rated it Medium, and that is now the rating of record.
2. **Confirmed, Low:** the state model's register of signed fields, as it stood at `c629d06c`, differed from the code in eight rows. The docs pass has since corrected the page.
3. **Added, Info:** a delivery can hold two envelopes addressed to the buyer, and whoever relays the paying call chooses which one the contract releases (the first review's I-4). The buyer's reference check already refuses such a delivery.

**It missed the one High finding of this package,** the postdated offer in the buyer's tool. It listed `createdAt` among the fields with no expectation and drew no consequence.

**Every question has a complete answer.** On the first run 4 of 23 answers stopped at the 32,768-token output limit. Each was split into smaller questions, 11 in all, and asked again at a 65,536-token limit; all 11 answers completed. The last question, on the descriptions, ran once at the commit named for the freeze and completed (section 3).

## 2. Scope and method

- **What the model was given.** For every question: `CLAUDE.md`, the five files of `contracts/src` with line numbers, and `docs/audit/threat-model.md`, all at `c629d06c`. A question on a dependency added that file from the vendored commits (`6b0a5ef` for Commerce Payments, `5ea5d9f` for Solady); a question on a document added the section it tests. The buyer-signer questions got `CLAUDE.md` and `examples/buyer-signer.ts`. Every file was read with `git show` at the commit, so nothing outside the public repository was sent. The runner printed the file list and the totals before the first call.
- **What it was not given.** The first review's findings, notes or tests. It had no tools and no network access.
- **The questions.** One narrow question for each call: one entry point, one theme or one document section, with a limit of 20 numbered claims of at most 120 words, each ending in a verdict. Most ask for the most damaging sequence the model can build, with the actor, the stage and the block times. The prompts and the raw answers are kept outside the repository, with the run's log.
- **How it ran.** Rafa ran one command from his shell; the key stayed in his environment and reached no session. The runner calls the provider itself: the repository's live client caps output at 8,192 tokens and turns the model's reasoning off, and no cap in product code is raised for a review. The model's reasoning was on.
- **The model.** `deepseek-v4-pro`, the stronger DeepSeek entry of `config/judges-live.yaml` (`deepseek-v4-pro@2026-11-01`). DeepSeek publishes no dated snapshot, so the ID is a provider alias.
- **How each claim was checked.** I read every claim against the code at the cited lines. Where a test could settle it, I wrote one (`contracts/test/crosscheck/R11Review.t.sol`).

**Two lessons of the earlier second-family read, and what this run did about them** ([`2026-11-11-drand-verifier-second-read.md`](2026-11-11-drand-verifier-second-read.md)):

| Lesson | This run |
| --- | --- |
| Three of four answers stopped at the client's 8,192-token limit | The limit was 32,768 tokens, then 65,536 for the re-ask. Every answer must end with a marker line, and the log records for each question whether it did. Four still stopped, all on the first run; each was split and asked again |
| The model missed the round finding | The questions ask for attack sequences and not only for a read. It still missed this package's High finding (section 4.3) |

## 3. The calls

**First run, 2026-11-12, 18:28 to about 18:44 UTC** [measured from the run's log]:

- 23 calls, 6 at a time. 19 answers complete; 4 stopped at the limit with an empty answer: question 4 (the fallback's and the escalation's rounds), question 12 (the EIP-712 encodings), question 16 (the state model's section 9) and question 20 (the diff from the deployed contracts).
- 833,111 input tokens, of which the provider's cache served 510,208; 578,142 output tokens, of which 549,844 were reasoning. The 19 answers total 102,666 characters.
- A question used 14,813 to 32,768 output tokens. The limit was set from a guess of 12,000; the measure is about 26,000.
- Cost about USD 1.37 at DeepSeek's off-peak list prices [inferred from the token counts and `config/model-prices.json`].

**Second run, 2026-11-12, 19:04 to about 19:13 UTC** [measured from the run's log]:

- 11 calls, the split questions only, at a 65,536-token limit. All 11 answers complete; the largest used 38,458 output tokens.
- 420,933 input tokens, of which the cache served 403,584; 223,233 output tokens, of which 210,967 were reasoning. The 11 answers total 41,606 characters.
- Cost about USD 0.46 off peak [inferred the same way].

**Third run, 2026-11-12, 19:42 to 19:48 UTC:** one call, question 24, at `0180a39f`, with the vendored escrow attached. Complete: 48,107 input and 47,216 output tokens, of which 45,765 were reasoning; 350 s; about USD 0.13.

**All three runs:** 35 calls, 1,302,151 input and 848,591 output tokens, about USD 1.95 [inferred; the provider's bill was not read]. The first run's console showed "1 s" for each question: the runner stopped its clock at the response's headers, which the provider sends at once. The second run's times are right, 116 to 321 s a question.

**Questions with no complete answer, and what was done:**

| Question | First run | Asked again as |
| --- | --- | --- |
| 4: the fallback's and the escalation's decisions | stopped at 32,768 tokens, nothing written | 4a (the fallback), 4b (the escalation): both complete |
| 12: the EIP-712 type strings and replay | stopped at 32,768 tokens, nothing written | 12a and 12b (the encodings, in two groups of types), 12c (replay): all complete |
| 16: the state model's section 9 against the code | stopped at 32,768 tokens, nothing written | 16a (rows P01 to P09), 16b (rows P10 to P17 and the closing reason), 16c (the holdings): all complete |
| 20: the diff from the deployed contracts | stopped at 32,768 tokens, part of an answer written and not used | 20a (removed checks), 20b (new behaviour), 20c (events): all complete |

**No question is left without a complete answer.**

## 4. Its claims, checked

The model made 342 numbered claims in its 31 complete answers [measured by counting]. It marked 257 OK and 30 unsure, and 52 as defects: 4 High, 16 Medium, 20 Low and 12 Info; 3 carry no clear verdict. Of the 52, 38 hold as stated (most are already recorded), 8 hold as facts at a lower severity than it gave, and 6 do not hold. This section lists every claim it marked as a defect or as unsure, and what holds. Claims it marked OK agree with the first review's section 4 unless a line below says otherwise.

### 4.1 The three it rated High: none holds

| Claim | What it says | Verdict | Why |
| --- | --- | --- | --- |
| Question 14, C4 and C8 | A stranger takes the buyer's funding signature from a pending `agreeAndFund` and uses it at the token directly. The price and the fee land in the collector, the nonce is spent, and no call takes the tokens out | **Does not hold on this deployment** | An ERC-3009 receive authorization can be used only by its payee. The Sepolia test token, the local token and the suite's token all refuse another caller (`contracts/script/TestUSDC.sol:69`, `LocalUSDC.sol:84`) [measured: `test_r11_second_strangerCannotUseTheFundingAuthorization`]. The model did not have the token's source. What is left is an assumption about the deployment's token (the first review's I-5) |
| Question 1, C7 | The relayer wraps the funding signature in ERC-6492 and makes Multicall3 call `transferFrom(buyerPaymentAddress, attacker, X)` during funding | **Does not hold** | The caller of that `transferFrom` is Multicall3 (`ERC6492SignatureHandler.sol:56-58`). It can move only what the payment address approved to Multicall3, and anyone can spend such an approval at any time by calling Multicall3 directly. The wrapper gives the relayer nothing new. The threat model's section 3 states the nested call |
| Question 23, C1 | With one party behind both operator nodes, agreement between them is not a check, so a dishonest operator can change the terms on both and the buyer signs and funds them | **Holds in part; not High** | The first half is the named question, and it is true. The second is not: the signer recomputes the commitment ID from the terms and recovers the seller's signature itself (`examples/buyer-signer.ts:670-672`), and the approval stop shows every value. What one operator sets is the default of four expectations the buyer left out (the first review's section 7.4) |

### 4.2 Claims that hold

| Claim | Its rating | What holds | Already recorded |
| --- | --- | --- | --- |
| Question 11, C2, C3, C5: a call that carries the key and reverts, expires or loses a race to a timeout has published the key | Medium | **Yes.** It is the first review's M-1, found independently. Two of its examples, the late-work settlement and the early accept, are paths where the buyer holds the envelope before it signs | Known issue "H-2 limit", extended on 2026-11-12 |
| Question 6, C4 and C9: two envelopes addressed to the buyer; the relayer chooses which is released | Medium | **Yes as a fact; Info.** `_requireKeyProof` takes any entry addressed to the buyer [measured: `test_r11_second_twoBuyerEnvelopes_theRelayerChoosesWhichIsReleased`]. The buyer's reference check refuses such a delivery (`examples/verify.ts:613-614`) | No: the first review's I-4 |
| Question 17, C4, C6, C8, C11, C12, C13, C16, C17: eight rows of the signed-field register differ from the code | Low, eight times | **Yes, all eight,** against the page as it stood at `c629d06c`: `maxSubmissions`, the bond reservation and the appeal window are enforced; the dispute fields, an escalation's appeal ground and a primary's beacon fields are not; the seed tag is 144 bits; the appeal rows describe a cut feature. One citation is off by a line (`R:153` for `R:154`) | The docs pass corrected the page (pull request 436) |
| Question 2, C8: a seller that signed two deliveries posts the one a pending decision does not name | Low | Yes | The threat model, the seller's row |
| Question 3, C7: the seed tag is 144 bits, so about 2^72 work buys the primary a choice between two seeds | Info | Yes | Known issue L-4's residual |
| Question 1, C8: nothing checks that the hold is above 0; the escrow refuses 0 | Info | Yes | ADR-0031 section 6: a stated limit |
| Question 7, C4 and question 13, C9: a signed settlement or early accept cannot land after the escrow's expiry | Info, Low | Yes [measured: the first review's expiry tests] | ADR-0033 section 2; the threat model's TA-1 |
| Question 14, C5: the ERC-6492 call is unsigned and its failure is ignored | Low | Yes | The threat model's section 3 |
| Question 18, C11: a settlement in Held can name an unposted delivery and release its key | Low | Yes, by decision | ADR-0031 section 6b |
| Question 18, C12: an escalation window of 1 s funds and can never be decided | Low | Yes | ADR-0032 section 5: a stated limit, 37 s on Sepolia |
| Question 19, C2, C3, C4: the constructor takes any non-zero address, any expiry margin and any beacon margin above 0 | Low, Low, Info | Yes | Deploy-time trust: ADR-0031's red-team finding L-5, ADR-0032 section 3.4; the deploy script reads each value back |
| Question 19, C17: `dealOf` still says funded after the payment address reclaimed on the escrow | Info | Yes | The threat model's TA-1 |
| Question 20b, C6: terms with a fallback window or an escalation window of 1 s fund and can never be decided under the 29 s margin, where the deployed contracts could decide them | Medium | Yes; Low, a stated limit. The margin raised both floors on purpose | ADR-0032 section 5; the state model's finding F-2 |
| Question 12c, C5: after a chain fork that keeps the chain ID, a signature is valid on both forks | Low | Yes, as for every EIP-712 domain | The threat model's TA-14 |
| Question 16c, C8: the state model's section 9.1 said funding refuses a zero price | Low | Yes, of the page at `c629d06c` | The docs pass corrected it (pull request 436) |
| Question 16c, C9: "the first decision by the primary or the fallback is final" is false if read literally, since an escalation is a decision and is not final | Info | Yes, as wording. The interface says it exactly: an accept or a reject is final when written | No: one sentence of the state model's section 9.1 |
| Question 20b, C8: `MUTUAL_FEE_SHARE_BPS` is read by no code, and `appealWindowSec` stays in the signed type only to be required 0 | Info | Yes | Known issue I-2 (the getter stays for the ABI); ADR-0033 section 2b |
| Question 20c, C8 and C9: a settlement's payout no longer emits `Paid`, and `FallbackTriggered` carries another round | Info | Yes; both follow stated changes | ADR-0031 section 10; ADR-0032 section 3.3 |
| Question 24, C7: the descriptions say an accept and an early accept "pay the seller" and that Released means "the seller paid"; at a price of 0 the seller receives nothing and the key is still released | Info | Yes, as wording. The event's description already says the amount is 0 at a price of 0 | No: a wording point for the next change to the descriptions |
| Question 24, C8: the comment says the primary reveals "the preimage of its seedCommitment, checked through the deal's tag"; the check is on a 144-bit tag | Info | Yes; the comment names the tag and known issue L-4 | Known issue L-4's residual |
| Question 21, C3: a misspelt optional key of the approval is ignored | Low | Yes; Info. `checkOffer` compares an optional field only when it is present (`examples/buyer-signer.ts:797-810`) | No |
| Question 21, C6 and question 23, C7: the chain and the token follow the operators' domain, and the buyer has no expectation for them | Low, unsure | Yes; Low | The first review's section 7 |
| Question 21, C11: `createdAt`, the windows, the remedy and the nonce have no buyer expectation | Info | Yes | It is the root of the first review's C-1 (section 4.3) |
| Question 22, C1: a resumed `agreeAndFund` signs the saved, checked terms without checking them again | Medium | Yes; Low. The terms were checked when they were saved; the case is a file from an older version | T-332 recorded the sibling case |
| Question 22, C3: `expect` is not saved, so a restart without it falls back to the operators | Medium | Yes | T-332; the first review's C-9 |
| Question 22, C4: one unreadable file stops `openDeals` and `loadKeys` for the whole store | Medium | Yes | T-332; the first review's section 7.2 |
| Question 22, C5: `openDeals` reads a watch path built from the file's own `address` before it validates it | Medium | Yes; Info. It needs write access to the key store, which holds the keys (`examples/buyer-signer.ts:286-288`, `:1146`) | The first review's subagent, as Info |
| Question 22, C2: a `paid` record in the key file is trusted | Low | Yes; Info, for the same reason | No |
| Question 23, C2 to C4: the settlement mode, the club, the rulebook and the policy hashes default to the operators' word | Medium, three times | Yes; `expect` closes each | The first review's section 7.4 |

### 4.3 Claims that do not hold, and what it missed

| Claim | Its rating | Why it does not hold |
| --- | --- | --- |
| Question 8, C9: nobody calls `triggerFallback` before `fallbackBy`; then the trigger and the default refund the buyer | Medium | It needs every other party silent or censored for the whole fallback window. Anyone may trigger from `judgeBy`, and a relayer can trigger and relay the fallback's decision in one transaction. It is the liveness assumption the docs already state (known issue R-4; the threat model's TA-6) |
| Question 11, C1: the buyer withholds a signed accept it obtained, and the deal then defaults | Medium | The adjudicator authored the decision and holds it; anyone who holds it can relay it |
| Question 21, C4: `sellerPayoutAddress` is optional in the approval, so the seller chooses where it is paid | Medium | True and intended: the payout address is the seller's to name (ADR-0033). The buyer loses nothing by it, and the offer shows it |

**What it missed.** The postdated offer (the first review's C-1): the buyer's tool counts its windows from the seller's `createdAt` and compares nothing with a clock. The model listed `createdAt` among the fields with no expectation (question 21, C11) and stopped there. It also did not find the dispute fields as terms that fund against the register's verdict until the question that put the register beside the code (question 17).

**What the split questions confirmed.** The fallback's round is fixed by the terms and the deployment alone, and it equals ADR-0032's rule for all three residues of `judgeBy` against the beacon's period; the model worked the three cases and got the round published 29 to 31 s after `judgeBy` (question 4a), which is the first review's figure. An escalation's `t1` is written once and nothing changes it (4b). Every type string lists its referenced types in alphabetical order and every struct hash encodes the string's fields in order (12a, 12b). Each of the rows P01 to P17 is written by the function the state model names (16a, 16b). Every check the lane removed from the deployed contracts belongs to a stated cut (20a).

**Its "unsure" claims** were of one kind: a file the question did not attach (the escrow, the collectors or the signature library on a question about the rules contract alone; the struct hashes of `Remedy` and `Disclosure`, which reach the contract already hashed). The question that attached each file answered them, and the first review's expiry tests measure the escrow's behaviour.

### 4.4 The descriptions, and the escrow's expiry (question 24)

**The model found every sentence about the escrow's expiry true of the vendored escrow, and no description that presents a cut feature as present.** It read the descriptions at `0180a39f` with `AuthCaptureEscrow.sol` attached, the expiry sentences first, as the reviewer of the descriptions asked.

| Sentence | The model's verdict | Checked |
| --- | --- | --- |
| The interface's deadlines: from the expiry the escrow refuses every capture, voids still work, and the payment address may reclaim | OK. Captures stop at the expiry second (`E:277-279`); a void has no time check (`E:304-316`); the payer's reclaim opens at that second (`E:323-327`). It adds that "voids still work" is imprecise once the payer has reclaimed, since a void of nothing reverts (`E:307-308`) | Agreed. The description of `_refundAll` says what the rules contract does in that case: it reads the escrow first and voids nothing |
| `EXPIRY_MARGIN`; `_escrowExpiry` | OK, exactly true | Agreed |
| `earlyAccept`: the capture is refused from the expiry when the price is above 0; at a price of 0 the void of the fee is refused once the payment address has reclaimed | OK, exactly true | Agreed; the second half is the sentence pull request 445 added [measured: the first review's test] |
| `mutualSettle`: the capture of a seller's share is refused from the expiry, and the void is refused once the payment address has reclaimed | OK, exactly true | Agreed |
| `reclaim`, `triggerDefault`, `_refundAll`: `Refunded` is emitted unless the payment address had already reclaimed | OK, exactly true | Agreed |

Its two Info claims on other descriptions are in section 4.2 (question 24, C7 and C8). The first review's own read of the descriptions is its section 8; the two reads agree.

## 5. Where this review did not look

- **The model's reasoning text.** The run kept its length and not its content; only the answers were read.
- **A second opinion on the checker.** One session wrote the first review and checked this one's claims. A claim it wrongly dismissed would be dismissed in both reports. The three High claims and the Medium claims are settled by code lines or tests a reader can run.
- **The arithmetic of the drand verifier,** which had its own second read (T-353).
- **Nothing more on the descriptions than section 4.4 reports.** The model read them once, at `0180a39f`, with the escrow attached; it did not read the docs the descriptions cite.

## 6. Joint summary of the two reviews

**Verdict of both reviews: no Critical or High finding in `contracts/src` at `0180a39f`, the commit named for the freeze, and nothing that needs a change to it.** Both read the code at `c629d06c`, which differs from `0180a39f` in comments only. Two readers of different model families read the same code; the second did not see the first's findings. Finding numbers are the first review's.

**What the two reviews show, and what they do not, for the freeze decision.**

- **Read.** Every line of the five files in `contracts/src`, by two readers of different model families. Every line of the vendored escrow, its token store, the ERC-3009 collector with its ERC-6492 handler, and Solady's signature checker, by the first reader in full and by the second through the questions that attached each file. The diff from the contracts deployed today. The audit docs, the descriptions and the buyer's signing tool.
- **Tested.** Ten new tests pin what the reviews state about the escrow's expiry, the last possible decision, the outcome check, the token's payee rule, and the findings themselves. They run with the lane's whole suite, which passes: the unit tests, the invariant suites with the state oracle, and the side-by-side harness against the deployed contracts.
- **Resting on reading alone.** That no call can pay an address the terms do not name, that no funded deal can strand tokens, and that every signature binds its deal, role and deployment. The invariant suites exercise all three over random sequences, but a property test shows the absence of a failure in the sequences it ran, not in all of them. No deal ran on a chain for these reviews, and the beacon's pairing arithmetic was not read again here: it had its own review and second read.
- **The assumptions the money's safety rests on.**
  1. **The token.** It moves exactly the amount asked, has no transfer hook, and keeps ERC-3009's rule that only the payee may use a receive authorization. Sepolia's test token does; the contract cannot check it, and the deployer names the token once.
  2. **The vendored escrow** at its pinned commit `6b0a5ef`, which holds every deal's funds. Both reviews read it and found it does what the rules contract relies on; neither audited it as its own subject. Its authors' audits are of that code, not of this use of it.
  3. **The beacon.** drand quicknet below its threshold, and the chain's BLS precompiles. If no round can be proven, no fallback or escalation decision lands and the case defaults to a refund; it cannot pay the wrong party.
  4. **The adjudicators the parties chose.** In phase one a wrong decision is final and bounded by one deal's price and fee.
  5. **Liveness.** At least one party, operator or stranger sends each timeout when it is due, and the chain includes it.
- **What an outside audit adds that these could not:** a reader with no stake in the design, and attention to the three assumptions above as subjects of their own.

**Fixed during the reviews, outside the contracts:**

| Finding | Severity | Where | State |
| --- | --- | --- | --- |
| C-1: the one-run buy funded an offer the seller postdated, which locked the buyer's hold until a date the seller picked | High | `examples/buyer-signer.ts`, `examples/buy-with-signer.ts` | Closed by T-390: pull request 446, `609cdd7e`, 2026-11-12. The first review read the fixed path (its section 7.5) |

**Nothing must be fixed in the contracts before the freeze.**

**For known issues** (each recorded, none fixed):

| Finding | Severity | Found by | State in `docs/audit/` at `57fba5e3` |
| --- | --- | --- | --- |
| M-1: a call that carries the buyer's key publishes it in its calldata even when the call reverts or loses a race | Medium | both, independently | Stated as known issue "H-2 limit" and in the threat model; unrated there |
| L-1: terms with dispute fields that are not zero fund | Low | both | The register says "Enforce: refuse nonzero. Not built" |
| I-1: an escalation's appeal ground and a primary's beacon fields are signed and not checked | Info | both; the phase-one red team before them for the first | Stated in the register |
| I-6: after an escalation's decision `t1` is still the escalation's time; a bad beacon proof reverts with the beacon's own error and not `BadSeed` | Info | T-384, while it wrote the descriptions; the first review checked both | Stated in the state model and in the descriptions |
| I-3: a plain key that takes delegated code (EIP-7702) loses its pending signatures | Info | the first; ADR-0031's red team before it | Stated under "H-2 limit" |
| I-4: with two envelopes addressed to the buyer, the relayer chooses which is released | Info | the second | Not stated: one line owed in the register |
| I-5: the funding's safety against a front-run rests on the token keeping ERC-3009's payee rule | Info | the first, from a claim of the second that does not hold here | Not stated: one clause owed in `scope.md` |
| C-2 to C-13: twelve findings in the buyer's tool, two Medium and ten Low | Medium, Low | the first's subagent; the second reached C-9 and the unreadable-file case on its own | Outside `docs/audit/`; T-390 and a client-lane row |

**For the outside auditor's attention:**

1. **M-1.** The contracts release the key only in the paying call, and the guarantee is about the `KeyReleased` event. Whether a seller's or an operator's relay practice is enough, or the protocol needs a way to commit to the key before revealing it, is a design question this package leaves open.
2. **The three dependencies no earlier review read in full:** the ERC-3009 collector with its ERC-6492 handler, `TokenStore.sol`, and Solady's `SignatureCheckerLib`. Both reviews read them and found nothing the rules contract relies on wrongly. The points that deserve a third reader are the unsigned ERC-6492 call during funding and the library's rule that an account with code is asked through ERC-1271 only.
3. **L-1 and I-1:** three "enforce" verdicts of the signed-field register that phase one does not build. Each is one comparison; none moves money.
4. **The stated limits a reader meets first:** a wrong decision is final (ADR-0031), an escalation window under 37 s and a fallback window under 44 s on Sepolia cannot be decided (ADR-0032), and after the escrow's expiry the deal's word and the escrow can differ until a timeout runs (the threat model's TA-1).

**The checks phase one does not build, and what building one now would cost.** Three signed fields have a verdict of "enforce" that the code does not implement: the dispute fields (L-1), an escalation decision's appeal ground (I-1; T-384 reported it too) and a primary's beacon fields (I-1). Each is one comparison that refuses a message.

| | Enforce now | Leave recorded |
| --- | --- | --- |
| What changes | `agreeAndFund` or `decide` in `contracts/src`, after the commit named for the freeze | Nothing in the code |
| What it costs | The full recipe for a contract change: a test that fails first, the unit, invariant and side-by-side suites with the new refusal on the list of allowed differences, the mutation run and the formal model's mapping for that function, a reviewer, and both families' read of the changed function again. Then a new commit to freeze | A recorded Low and two Info findings that the outside auditor will read on its first day |
| What it buys | A signed field a reader might take as checked becomes checked. No money, key or state depends on any of the three today | The freeze holds, and the three go into the audit's own round of fixes with whatever else it finds |
| The risk | A late change to code that two reviews and every suite have just covered, and a later freeze | None to funds. A deal sent straight to the contract with dispute fields set falls behind the operators' view, which the docs already record |

Both reviews recommend leaving them recorded for phase one and taking them with the audit's fixes. The choice is Rafa's.

**What the fix of C-1 means for the other work.** It changed `examples/` only, and `contracts/` is the same before and after it [measured]. The mutation run, the formal model and the side-by-side harness cover `contracts/src` and need no rerun. The agent docs (`site/llms.txt`) and the pilot kit follow the buyer's tool.

**What the two reads did not settle.** Neither ran a deal on a chain, and neither read the token beyond its payee rule. The second review's checker is the first review's author (section 5).
