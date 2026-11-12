# T-397: every client command answers `--help`

- **Lane:** docs and client tools, on the branch `contracts-audit-ready`
- **Phase:** 2
- **Depends on:** T-393 (`site/buy.mjs`), T-396 (the usage lines in the buyer's order), T-390 part 3 (`examples/entry.ts`)
- **Paths this task may touch:** `examples/` (the client commands and a shared help module), `site/buy.txt`, `site/buy.mjs` as the build writes it, their tests, this file. Off limits: `site/build.mjs`, `site/check.mjs`, `site/index.html`, `tools/duet/` (T-391's).
- **Human gate:** no. Rafa approved the task (2026-11-12, "Yes, all three"). Nothing deploys.
- **Status:** in progress
- **Agent/session:** T-393's session, kind 1

## Intent

In the cold-start run, the buying agent was told only "we will pay through crow.direct". It read none of Crow's guides: it read the seller's page and learned the commands from their usage lines. It closed the deal for USD 0.023, the cheapest buyer of the three live runs [measured, as the coordinator reported it from the run's record]. Its five refused calls were all help problems. So a command's own help is what a buyer actually reads.

This task makes every client command a buyer or seller runs answer `--help` and `-h` with exit status 0. The answer has three parts: a line saying what the command does, the usage, and one complete example call with realistic values and no secret. A wrong call prints the same text and exits non-zero, as before. Inside the single file the help names its own form (`node buy.mjs pay …`, `node buy.mjs record …`). The buyer's example in the help and the call in `buy.txt` are the same call.

Limits:
- `examples/buy-with-signer.ts` stays within its 50-line cap.
- Each role's first-deal path stays within 5,000 tokens.
- The bundles are rebuilt so their pinned hashes match.
- The site check and the cut-feature list test pass.

## Acceptance criteria

- [x] `buy-with-signer`, `pay-from-wallet`, `deal-record`, `check-delivery` and `seller-adapter` answer `--help` and `-h` with exit 0, printing what the command does, its usage and an example. A call with no arguments prints the same text and exits 2 [measured].
- [x] In `site/buy.mjs`, `node buy.mjs --help`, `-h`, `node buy.mjs pay --help` and `node buy.mjs record -h` answer with exit 0, in the bundle's own names [measured, `tests/site-guides.test.ts`].
- [x] The example that `node buy.mjs --help` prints is a line of the published `buy.txt` [measured, the same test].
- [x] `buy-with-signer.ts` is 50 lines; both paths are within budget; the site check passes; `buy.mjs` is rebuilt.
- [ ] One reviewer; findings fixed.
- [ ] Merged by hand into `contracts-audit-ready` once `check` and `gitleaks` pass.

## Out of scope

- `adapter-log`: it is the run tool's command (`tools/duet`), not one of ours. In the run, the refusals of `--help` for `check-delivery`, and the usage lines the buyer met, came from the run tool's wrapper. T-391's session is making the wrapper pass `--help` through to the command.

## Evidence

**What each command prints** [measured, unbundled, 2026-11-12]. `node examples/<command>.ts --help` and `-h` exit 0. A call with no arguments exits 2 and prints the same three parts.

| Command | Example in its help |
| --- | --- |
| `buy-with-signer` | `HOLDBACK_OPERATORS=$OP1,$OP2 node … https://seller.example/quote deal-1 '{"commit":"7c1e…","files":["contracts/Vault.sol"]}' 750000000 https://seller.example/defaults` (the same call as `buy.txt` step 3) |
| `pay-from-wallet` | `HOLDBACK_OPERATORS=$OP1,$OP2 node … files deal-1 0x5744…09f7` |
| `deal-record` | `HOLDBACK_OPERATORS=$OP1,$OP2 node … 0x5744…09f7 --as buyer --out record.json` |
| `check-delivery` | `node examples/check-delivery.ts terms.json work.json` |
| `seller-adapter` | `node … seller.json --sim` |

**Where the text lives.** `examples/help.ts` holds the purpose line, usage and example of `buy-with-signer`, `pay-from-wallet`, `deal-record` and `seller-adapter`. Each is named through `entry.ts`'s `command()`, so it reads `node examples/<name>.ts` unbundled and `node buy.mjs …` in the bundle.

`check-delivery` keeps its three lines in its own file: its test holds its imports to a fixed list (no network, no child process), and `help.ts` would add one. `buy-with-signer.ts` imports `asksHelp`, `command` and `help` in one line and checks for help in its existing guard line, so it stays at 50 lines.

**Checks** [measured]:
- **Site check:** `node site/build.mjs && node site/check.mjs` passes.
  - buyer: 19,165 bytes, about 4,792 of 5,000 tokens. It was about 4,775; one sentence in step 3 says `--help` prints the usage and the example.
  - seller: about 4,137 tokens, unchanged.
- **The bundle:** `site/buy.mjs` is rebuilt, SHA-256 7328d91d2b7cf391319343b347d004bdbf3c203e634576c1cf53c2e048a39f05, 197,478 bytes. `site/try.mjs` is unchanged.
- **Tests:** 8 files, 143 tests passed: `tests/site-guides.test.ts`, `examples/buy-with-signer.test.ts`, `buyer-signer.test.ts` (the 50-line cap), `entry.test.ts`, `deal-record.test.ts`, `check-delivery.test.ts`, `seller-adapter.test.ts` and `tests/cut-feature-alignment.test.ts`.
- **Static checks:** eslint and `tsc -p examples` are clean.

## Decisions

- **One help module, with one exception.** Four commands share `examples/help.ts`, so the text and its example live in one place and the bundle names itself. `check-delivery` keeps its own text, because its import list is a test-held guarantee.
- **A wrong call prints the whole help**, not only the usage. In the run, the buyer met only usage lines, without an example.

## Handoff

To be completed at the merge.
