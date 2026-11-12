# Contract review brief (T-206 human gate, 2026-11-06)

This page is for Rafa's read of the T-206 contract review, and takes about 5 minutes. The full review is [`2026-11-03-contract-review.md`](2026-11-03-contract-review.md); DeepSeek's answers are in [`2026-11-03-contract-review-deepseek.md`](2026-11-03-contract-review-deepseek.md).

Labels: **measured** (a test, tool or command shows it), **inferred** (from reading the code or the records), **guessed** (a judgement nobody checked).

Terms used below:
- **The rules contract** (`HoldbackRules`) checks each deal's signed messages and moves its money.
- **The bond vault** (`HoldbackBonds`) holds the money adjudicators post as a guarantee.
- **CPP** is Coinbase's audited Commerce Payments escrow, which holds the buyer's funds for the rules contract.
- **The content key** unlocks the delivered work. **A panel seed** picks which AI judges sit on a case.

## 1. Verdict

The review covered Crow's settlement contracts in `contracts/src/` at `baac930` on 2026-11-03, and follow-up passes covered the fixes now live on Sepolia at `64be1f1` (rules contract `0xF38287e5C5C1F20c6D03be500EDBF8A244f27cFA`). Two model families reviewed them (Anthropic's Claude Opus 5.5 and Fable 5.1, then DeepSeek v4 pro), with two static analysers (Slither 0.11.6 and Aderyn 0.6.8) and a cross-check against published audits of similar contracts. It found 2 high, 3 medium, 8 low and 13 informational findings; all 5 high and medium are fixed, and the items still open block only mainnet.

| Severity | Found | Fixed | Open |
| --- | --- | --- | --- |
| High | 2 | 2 | 0 |
| Medium | 3, and 1 low raised later | 3 | 1: L-5, the unbonded appeal adjudicator |
| Low | 8 | 2: L-1, L-7 | 5, besides L-5 |
| Info | 13 | the overturn payout part of I-8 | each has a written disposition (review §2.3) |

[measured: each fix PR merged with regression tests that fail before the fix (T-206 Evidence); no contract source changed after `64be1f1` (`git log 64be1f1..origin/main -- contracts/src` is empty)]

## 2. Fixed

| Finding | What went wrong | Fix |
| --- | --- | --- |
| H-1, high | The appeal adjudicator could choose its own judges: an unchecked counter in its decision let it try 256 panels and keep the one it liked. | #120; core and SimChain #173 |
| H-2, high | An appeal decision could release the content key to a buyer already refunded, so the buyer kept the money and the work. | #125; SimChain #173; reference adjudicator #175 |
| M-1, medium | After a buyer took its money back straight from CPP, every bond on that deal stayed locked for good. | #122 |
| M-2, medium | A seller could carry a delivery inside a decision after the delivery deadline, and beat the buyer's refund. | #127 |
| M-3, medium | A sham deal could lock another adjudicator's bond without its consent. On Sepolia that takes the demo adjudicator offline for free. | #135 |
| L-1, low | Decisions and early accepts named an attempt, not the exact delivery. Now they name the delivery by hash (ADR-0029). | #161 |
| L-7, low | The party a decision favoured could take the only appeal slot. Now only the losing party appeals. | #160 |
| I-8, main part | An overturned decision paid nobody. Now the wronged party gets the price from the first adjudicator's bond (D43). | #160 |
| PA-M2, medium, outside the contracts | The operator-fee bundle in the EVM adapter could be front-run. | #138 |

Every PR above merged between 2026-11-03 and 2026-11-04 [measured: `gh pr list --state merged`].

## 3. Accepted or deferred

None of these puts the Sepolia deployment at risk. Its token is worthless test tUSDC, and a flaw found later costs a new deployment that new deals opt into [inferred, T-206 Decisions 7]. The last column says whether the item would matter with real money.

| Item | What it is | Why it is acceptable on Sepolia | With real money |
| --- | --- | --- | --- |
| L-5, medium since D43 (T-212 item 5) | The appeal adjudicator posts no bond, yet its overturn now moves the price out of the first adjudicator's bond. | Each primary consents to the appeal adjudicator by accepting the terms, and the demo adjudicators decline terms naming one they do not trust (#161). | **Yes. Blocks mainnet:** litmus test 3 wants appeals backed by a bond. |
| L-3, the minimum appeal bond | An appeal with a zero bond is accepted, so a free appeal can win the price from the decider's bond. | The same consent bounds it, and the bonds are test tokens. | **Yes. Blocks mainnet.** The rate goes in the signed terms, so it needs an ADR. |
| L-8 (T-212 item 8) | Terms whose judging deadline has already passed at funding make the fallback's seed public before signing. | Crow's reference flow refuses that schedule; a buyer would have to sign such terms directly. | Yes, for a careless buyer. Blocks mainnet. |
| L-6 (item 4) | A judging deadline after the escrow's expiry stops the primary's on-time decision from paying out. Bonds stay safe since M-1. | It needs self-contradictory terms, which the reference flow never writes. | Yes: the seller under such terms goes unpaid. Blocks mainnet. |
| L-4 (item 2) | The primary's seed is checked on 144 of 256 bits, the same way on every deal. About 2^72 hash attempts buy a two-way choice of panel on every later deal. | That work costs far more than anything on a testnet [inferred]. | Eventually. Blocks mainnet. |
| L-2 (item 1) | The bond vault trusts the amount it is told, so a token that takes a fee on transfer leaves the last withdrawer short. | tUSDC takes no fee. | Only if a club allows such a token; USDC takes none. Blocks mainnet. |
| I-2 (item 6) | Dead code for a fee share that is always 0. | No effect. | No. Cleanup at the next redeploy. |
| The rest of I-8 (Phase 4) | No compensation from silent adjudicators' bonds on a default, and no appeal fee. After M-3 a silent adjudicator holds no reserved bond, so compensation needs a consent step first. | A defaulted Sepolia deal pays the seller 0 test tokens, and round 1 records that (T-216, scenario 3b). | Yes: a seller whose adjudicators all go silent gets nothing. |
| The primary picks its own seed (DeepSeek, medium; ADR-0018, not adopted) | The primary fixes its seed when it accepts the terms, so it can pick a favourable one. | An appeal, which now pays, and the parties' choice of primary bound it. | Yes, once clubs open to strangers (backlog). |
| Chain checks | The beacon verifier agreeing across geth, reth and revm; precompile gas on mainnet; appeal rounds that follow block time (I-5). | The beacon verified a real drand round on Sepolia [measured]. | Yes. Part of the mainnet chain choice. |
| Doc items | I-1 and the compensation lines in `docs/neutrality.md`; the EIP-7702 note (I-4) and the beacon code-hash check in `llms.txt`; the formal README's contract column; ERC-8183 event names (I-10); the beacon's Sepolia gas (I-13). | None moves money. | No. |

Before any mainnet deployment, whatever the list: an external paid audit and legal advice (D4).

## 4. What you confirm

**Confirmed, 2026-11-06.** Rafa read this brief and confirmed all three items in chat (his reply is at the end; T-206 Decisions 7). Nobody had answered on PR 150, which merged on 2026-11-03 with no comment or review [measured: `gh pr view 150 --comments`].

- [x] **1. The Sepolia go-ahead.** On 2026-11-03 the deploying session took your approval second-hand from the coordinating session: "You can deploy on Sepolia, just give me the address you need faucet funds to if you can't get them yourself" (T-206 Decisions 7).
  - *Confirm* means you gave it. The live contracts at `64be1f1` rest on your direct "Yes, redeploy now" of 2026-11-04 (T-212 Handoff), so this mainly settles the record.
  - *If you don't,* the 2026-11-03 deployment at `2342756`, which the demo left on 2026-11-04, stays recorded as unapproved, and T-206's last criterion stays open. Nothing on chain can be undone: the contracts have no owner.
- [x] **2. The deployer keystore.** The throwaway deployer key (`0x1A4435488eaF1A37d2327d44Fe67e97d83203B64`) is an encrypted Foundry keystore. Its password sits in a file only your user can read. Both are in `~/.foundry/keystores/`, outside the repository. This departs from `CLAUDE.md`'s rule that secrets come only from environment variables; the coordinating session chose it.
  - Today the folder holds those two files, each mode 0600, and no copy sits in any checkout [measured: `ls -la` and a name search to depth 5; the contents were not read]. The key has no power over the contracts and pays only test gas.
  - *Confirm* means you accept this exception for testnet deploys.
  - *If you don't,* the next deploy reads its key from an environment variable, and you retire the keystore yourself.
  - Optional: a deny rule for `~/.foundry/keystores/**` in `.claude/settings.json`, which agents do not edit. Today it denies only `.env*` [measured].
- [x] **3. The two gates still open at the deploy.** Both were written as "before Sepolia" or "before any public chain".
  - *The beacon verifier's review by a second model family:* closed after the deploy, when DeepSeek passed all 15 checks (review §8). Left for mainnet: client agreement (geth, reth, revm) and the external audit.
  - *The six planned `neutrality.*` fixtures,* scenario tests in which one actor goes offline or refuses: the appeal adjudicator offline after a party appeal, a club revoking a member mid-deal, an on-ramp refusing, the beacon down for a whole window, a model-provider outage, and maintainers changing the judge registry. None exists yet [measured: `fixtures/scenarios/`]. Decisions 7 made them gate the cutover to Sepolia for any fallback or appeal on chain (T-213), and mainnet.
  - The cutover ran on 2026-11-03. Your round 1 run on 2026-11-05 passed appeal decisions with drand proofs on Sepolia (T-216, scenario 6) [measured: T-216 Evidence]. So the testnet half of that gate is already crossed [inferred].
  - *Confirm* means the six fixtures and the verifier's remaining checks gate mainnet only.
  - *If you overrule,* say what they gate instead. The likely choice is round 1's remaining fallback and appeal scenarios (4, 5b, 7 and 8), which would then wait for the fixtures [inferred].

## 5. Your decision today

Rafa, 2026-11-06: "No additional open-ended review". The extra open-ended pass by an OpenAI or Google model, which the PR 155 reviewer suggested, does not run. The two-family criterion stays ticked on the DeepSeek pass, with its limit on record: its questions came from the session that held the findings, so its agreement on those findings was prompted (review §8). The external audit before mainnet remains (D4).

## Your reply

Rafa's reply in chat, 2026-11-06, relayed verbatim by the coordinating session:

> 1. Confirmed: I approved the Sepolia deploy of 2026-11-03.
> 2. Confirmed: the deployer keystore exception, for testnet deploys only.
> 3. Confirmed: the six planned neutrality fixtures and the verifier's remaining checks gate mainnet only.

T-206 records it in Decisions 7 and ticks its last acceptance criterion; T-206 is done. The external audit before mainnet remains (D4).
