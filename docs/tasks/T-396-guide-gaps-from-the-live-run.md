# T-396: four gaps in the guides from the first live two-agent deal

- **Lane:** docs (the site's agent guides), on the branch `contracts-audit-ready`
- **Phase:** 2
- **Depends on:** T-393 (the short guides and `site/buy.mjs`); the run's record, from T-391's duet
- **Paths this task may touch:** `site/` (guides, `guides.mjs`, the bundles), `examples/` usage text and the caller in gap 3, their tests, this file
- **Human gate:** no. Rafa approved the task (2026-11-12, "Yes, fix them"). Nothing deploys.
- **Status:** in progress
- **Agent/session:** T-393's session, kind 1

## Intent

The first live two-agent deal worked, but each agent stumbled on the docs on its way. Run on the lane at f5f7447 on the local simulator: a DeepSeek buyer and a Claude seller, Released in 105 s, 33 model turns, USD 0.43, 0 stalls [measured, from the run's summary as the coordinator reported it]. This task closes the four stumbles, so the next agent does not repeat them:

1. **The seller could not write its adapter config from `sell.txt`.** It read two reference files and tried to fetch the example config from GitHub, which its allowlist refused. The smallest working config, and the card a buyer needs, belong on `sell.txt` itself.
2. **The buyer's first two calls to its signer were refused.** The first had the wrong key-store path, the second the wrong arguments. `buy.txt` needs one exact example call, and the signer's own usage text must give the same arguments in the same order.
3. **The seller drew two 404s** from `GET /v1/agents/<its own address>`. Find the caller and stop the call where its answer is not needed.
4. **The buyer guessed nine paths** when the seller's page was not up yet. `buy.txt` should say: wait and retry the same address, never guess.

Limits: each role's first-deal path stays within 5,000 tokens. The buyer's was about 4,760, so every added line is paid for by a trim. The site build and check pass, and the pinned bundles match their hashes. The cut-feature list test passes. Nothing under `contracts/` or `tools/duet/` changes, and nothing deploys.

## Acceptance criteria

- [x] Gap 1: `sell.txt` step 5 shows the smallest working `seller.json`, so no fetch off the site is needed, and step 9 shows the smallest card. The minimal file started the adapter on `pnpm sim` [measured].
- [x] Gap 2: `buy.txt` step 3 gives one exact example call with the five arguments in order. `buy-with-signer`'s usage gives the same arguments in the same order, named as it is run (`node buy.mjs …` in the bundle). The usage of `pay-from-wallet` and `deal-record` is named the same way: `node buy.mjs pay …` and `node buy.mjs record …`.
- [x] Gap 3: on the test service, a seller the adapter's journal has not seen hold a mandate asks the faucet first, so the adapter no longer reads a mandate that a fresh address cannot hold. A scripted run's record shows no API error.
- [x] Gap 4: `buy.txt` step 2 says to wait a minute, fetch the same address again, and never guess other paths.
- [x] Budgets hold, the site check passes, and the bundles are rebuilt.
- [x] One reviewer; findings fixed (below).
- [ ] Merged by hand into `contracts-audit-ready` once `check` and `gitleaks` pass.

## Out of scope

- `tools/duet/` (T-391's session, with a pull request open there). In this run, its tool wrapper printed its own usage line for `buy-with-signer`, and the runner started both sides at once (T-391 is fixing that).
- A one-file bundle for the seller's adapter, like `site/buy.mjs`. `sell.txt` step 1 still clones the repository for the adapter's code.

## Evidence

**The run's record** [measured: `record.jsonl`, read only]:
- **Seller:** after `llms.txt` and `sell.txt` it fetched `ref/seller-adapter.txt` and `ref/intake.txt`. It then asked for `https://raw.githubusercontent.com/…/examples/seller-adapter.config.json`, which was refused as not on its allowlist. Its first working `seller.json` was 190 bytes: `sellerApi`'s three addresses and `port`. Its card was `{"type": "crow-agent", …, "offers": [{… "pricing": {"kind": "quoted", "quote", "defaults"}}]}`.
- **Buyer:** `buy-with-signer` was refused twice before the call that stopped for approval. First, "the key store is …": the duet's owner sets the key store's path. Then the duet wrapper's usage line, after a call with no arguments.
- **The 404s:** `GET /v1/agents/0x112e…0904` answered 404 at both operators, at 21:44:20.061Z and 20.062Z. Both came from the seller, 27 ms before the adapter logged "The seller took a mandate … from the test service's faucet".
- **Gap 4:** before the seller's page existed, the buyer fetched `/sellers/audit-reports/` and then guessed `index.html`, `index`, `quote`, `defaults`, `sell.txt`, `llms.txt`, `page` and `agent.json` under it, plus the bare path, which was refused.

**The caller in gap 3.** `examples/seller-adapter.ts`, `checkMandate` read `mandateEnd()` (`GET /v1/agents/<seller>`) before it asked the faucet. That read is a 404 for an address no club has admitted. The code already handled it as "no mandate", but the call still counted as an API error.

Now the journal lists, in `mandatesSeen`, each seller address and club it has seen hold a mandate. On the test service, a seller not on that list asks the faucet first. If the faucet refuses, the adapter reads, and once a read finds a mandate the seller joins the list, so the refusal does not repeat. Every other case reads first, as before.

**After the change** [measured, 2026-11-12]:
- **Scripted duet, paid:** `pnpm duet run --scenario paid --buyer scripted --seller scripted`. 134 API calls and no error. The two `/v1/agents` reads now answer 200, after the grant. Every measure is within its limit, with no ticket.
- **Rehearsal:** `pnpm audit-deal --case released` ends `1 of 1 case ended as expected.`, and its `refused request: GET /v1/agents/… answered 404` lines are gone. So `sell.txt` step 2 no longer mentions them.
- **On `pnpm sim`:** the minimal `seller.json` from step 5 started the adapter with `--sim` and served `/defaults`. It now prints seven start-up lines, the faucet's mandate line first, and six on a restart with the same journal and key. Step 5 says so.
- **The bundle's usage text:** `node buy.mjs` with no arguments prints the usage in `buy.txt`'s order, as `node buy.mjs <quote URL> <key store directory> '<scope as JSON>' <the most you pay, base units> [<defaults URL> …]`, and the approve and resume forms. `node buy.mjs pay` prints `usage: node buy.mjs pay files …`, and `node buy.mjs record` prints `usage: node buy.mjs record <commitmentId> …`.
- **The first-deal paths** (`node site/check.mjs`, bytes divided by four):
  - buyer: 19,097 bytes, about 4,775 of 5,000 tokens. It was about 4,760. Most of the added lines were paid for by trims: step 3's errors and the rules for every step were tightened, "Where to go next" was dropped (it repeated the front door's reference list), and step 10's hand-written reclaim command became a pointer to `ref/after-funding.txt`.
  - seller: 16,546 bytes, about 4,137 tokens. It was about 4,011.
- **The bundles:**
  - `site/buy.mjs` is rebuilt: SHA-256 84bbcdc5ec927ed122e1e76bd5b9a60ca6a2bf3f5396f9ef5bd786b49dbfd447, 194,884 bytes. `buy.txt`'s install line carries it, filled by the build.
  - `site/try.mjs` is unchanged (182042421b68…), because nothing it bundles changed.
- **Tests:** after the review's fixes, `tests/site-guides.test.ts`, `examples/buy-with-signer.test.ts`, `entry.test.ts`, `deal-record.test.ts`, `seller-adapter.test.ts` and `tests/cut-feature-alignment.test.ts` pass: 6 files, 80 tests. eslint and `tsc -p examples` are clean.
- **The review** (reviewer subagent; ISSUES, none a safety problem). It ran the site check, the scripted duet, the rehearsal and one sim session. Fixed:
  1. The seen-mandate mark belonged to the journal, not to a seller. The restart in `sell.txt` step 9, with a new key and the same journal, would have read first and drawn the 404 again. It now names the address and club. A new test starts one journal as key A, again as A, then as a fresh key B. Only A's first start and B's start ask the faucet.
  2. After a faucet refusal, a read that found a mandate did not mark it seen, so every start asked the faucet again. It now marks it.
  3. Step 5's start-up count held only for a fresh journal, and its `--sim` sentence said the account came with a mandate. Both are reworded.
  4. The trim had dropped where the scope's fields come from. That is restored.
  5. Gap 4 had no limit. The step now says to try the same address a minute apart, up to five times, then tell the owner, and covers a page with no card.
  6. With no arguments, `buy-with-signer` threw its usage as an error with a stack trace. It now prints the usage and exits 2.
  7. A misplaced doc comment is moved.

## Decisions

- **Gap 3: faucet first, read as the fallback.** This only skips a read whose answer is known to be "none". On the test service, a fresh journal's start asks the faucet, which mints 1 base unit on Sepolia, about one block; it did that before too, after the read.
  - Cost: a reused key with a fresh journal gets one more grant. That is harmless, and if the faucet refuses within its hour, the adapter reads, as before.
  - Outside the test service, nothing changes: the read stays, and its 404 stays handled.
- **Gap 2: the usage is printed when the call is wrong.** With no arguments, `buy-with-signer` prints the usage alone. With a wrong fourth argument, the reason comes first and then the usage, so the existing "the most you pay is base units" text stays.

## Handoff

To be completed at the merge.
