# T-441: one pinned command per benchmark goal, and llms.txt leads with them

- **Lane:** demo (agent access)
- **Phase:** 2 (roadmap stage 1, "Outsiders can use it")
- **Depends on:** T-229 (`try.mjs`, the one-command buy), T-412 (the benchmark harness and its six live runs of 2026-11-14), T-420 (the test seller's four named offers), T-239 (the test buyer)
- **Paths this task may touch:** `examples/goal-kit.ts`, `examples/try-sell.ts`, `examples/try-judged.ts`, `examples/try-reclaim.ts`, `site/try-sell.mjs`, `site/try-judged.mjs`, `site/try-reclaim.mjs` (generated), `site/build.mjs`, `site/check.mjs`, `site/llms.txt`, `site/index.html` (regenerated), `site/ref/intake.txt`, `site/ref/after-funding.txt`, `apps/test-agents/src/try-goals.test.ts`, `eslint.config.js` (the three bundles' ignore line), this file. Not `tools/one-click/` (another session adds a second benchmark mode there), and not `examples/try.ts`, `site/try.mjs` or `site/buy.mjs`, which stay pinned by their hashes.
- **Human gate:** yes for the site deploy only (Rafa's). The pull request itself is pre-approved.
- **Status:** review (2026-11-14)
- **Agent/session:** the coordinator's side session for the benchmark approvals (triage tasks 1, 2 and 3 of 2026-11-14), worktree `.claude/worktrees/t-guide-budget-cut-acd89a`
- **Roadmap row:** N38 (absorbed N72: one pinned, hash-checked command per deal, 1 approval), B1
- **Change kind:** 1 (agent docs) and 4 (client code that signs, with its tests); one red-team pass on key handling, as the brief asks

## Intent

The headline metric is approvals per deal, target 1. The six live benchmark runs of 2026-11-14 measured a median of 11 (8 to 28). Of 103 permission prompts, 47 were the agent reading docs (`llms.txt` and eight `ref/*.txt` fetches) and 46 were the agent writing, installing (`viem`, `tweetnacl`) and running its own scripts. T-229's homepage buy already reaches 1 approval with one pinned command. Restated: give every goal the benchmark covers its own pinned command, so the agent writes and installs nothing, and make `llms.txt` lead with those commands, so the agent reads one page and runs one command.

- Three new commands, each one self-contained file the agent fetches and runs only on a SHA-256 match, as `try.mjs` is, but with viem and tweetnacl bundled in, so there is no `npm install`:
  - `try-sell.mjs`: sell to Crow's test buyer (scenario s3; `--sample robot-log` for s6; `--work`/`--terms` for your own);
  - `try-judged.mjs`: a rubric-judged buy from the test seller (s2);
  - `try-reclaim.mjs`: fund an offer the seller never delivers, wait for `deliverBy` and reclaim (s5).
- `llms.txt` opens with one command per goal; the reference becomes one optional file, `reference.txt`, in place of the eleven `ref/` links. The "No humans needed" line stays. The first-deal budget stays 5,000 tokens for each role.
- Five doc gaps the agents guessed at are closed: what `from` holds in a `crow-request`; where `"offer"` goes in a proposal; what a checks-only deal's rubric looks like in the terms; where the payout address comes from; and that `reclaim` runs on the block's timestamp.

Non-goals: changing `try.mjs`, `buy.mjs` or the harness (`tools/one-click/`); a rubric the buyer writes itself (the test seller counter-offers its own rubric, so the command buys the seller's published rubric and prints it before it funds); a seller's own payout address in `try-sell` (it is paid at its fresh signing address).

## Acceptance criteria

- [x] Three new commands in `examples/`, bundled by `node site/build.mjs` into `site/try-sell.mjs`, `site/try-judged.mjs` and `site/try-reclaim.mjs`; each imports only Node's own modules, and `site/check.mjs` fails when one is stale.
- [x] Each command is pinned the way `try.mjs` is: `curl -fsSLO`, then `shasum -a 256 -c` against the hash in the command, then `node`. No npm.
- [x] `try.mjs` and `buy.mjs` are unchanged (their hashes below match `main`).
- [x] `site/llms.txt` leads with one command per goal and points to one optional `reference.txt`, which the publish build writes from every `ref/*.txt`; the check enforces both.
- [x] Each role's first-deal path stays under 5,000 tokens; the budget is not raised.
- [x] The five doc gaps are closed in `ref/intake.txt` and `ref/after-funding.txt`.
- [x] A scripted run of each command against the in-process world and the real test seller or test buyer code reaches its end state (s2, s3, s5, s6), in CI.
- [x] A red-team pass on key handling; its findings fixed or recorded.

## Evidence

- **The new commands and their hashes** [measured, `node site/build.mjs`, 2026-11-14]. Each file is about 360 KB, imports only `node:fs`, `node:crypto` and `node:module`, and is pinned in `llms.txt` by its sha256:
  - `site/try-sell.mjs`: `eb385594a76dc2bfd2eeeebe80e8de35128ae942f0f30db870a60c5833f680bc`
  - `site/try-judged.mjs`: `80ed499179526e1eb7273ecdfaaa549f016bcba3d8d8ba24703258c5f48d5a26`
  - `site/try-reclaim.mjs`: `ee7787a2d30d2c406cde809384e8ae1978e2914eb70205aac7d3087e2bdc6fa8`
  - unchanged: `site/try.mjs` `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8` and `site/buy.mjs` `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88`; `git diff origin/main -- site/try.mjs site/buy.mjs` is empty.
- **The guide budget per role** [measured, `node site/check.mjs`, bytes divided by four: no count_tokens key in this session]: buyer (`llms.txt` + `buy.txt`) 4,643 of 5,000 tokens; seller (`llms.txt` + `sell.txt`) 4,255 of 5,000. The plain-HTTP buyer's path (T-426) is within its 9,450 ceiling (`tests/site-guides.test.ts` passes); the first draft passed it by 104 tokens, and `llms.txt` was cut rather than the ceiling raised. An agent with one of the six goals now reads only `llms.txt`: 6,712 bytes published, about 1,680 tokens. The optional `reference.txt` is 120,236 bytes, about 30,000 tokens, for an agent that fetches it.
- **Scripted runs** [measured, `pnpm vitest run apps/test-agents/src/try-goals.test.ts`]: 10 of 10 pass, about 36 s. Each published bundle runs in its own Node process against the demo's own world on two origins and the real test seller or test buyer code: s2 (`try-judged`, Released, and `--outcome refund`, Refunded, with a stand-in panel), s5 (`try-reclaim`, Refunded, with settlement time moved past `deliverBy`), s3 (`try-sell`, Released), s6 (`try-sell --sample robot-log`, Released, and `--outcome refund`, Refunded), and `--work`/`--terms` with the seller's own file. The harness's own scripted mode (`tools/one-click/bench.mjs`) was not changed: another session owns `tools/one-click/` today, so s2 and s5 still read `blockedBy` there (Handoff).
- **Live runs on Sepolia** [measured, 2026-11-14, test tokens only, the bundles run from this worktree against the live operators and test agents]:
  - s3, `node site/try-sell.mjs`: Released in 77 s, commitment `0xa8619d1ef71964ed83d8e498ea0cc7c121140f824aef3d9980a9ea61636f89e3`.
  - s6, `node site/try-sell.mjs --sample robot-log`: Released in 65 s, commitment `0x66649ce0d08cdd75a55fa2f5b97fef35c99f77704b62adfed6ab63eb518c3bc6`, all five format checks passed.
  - s2, `node site/try-judged.mjs`: Released in 123 s, commitment `0x977818ede8ab6aaba5b8b0e453a731c2d2fca4f5c2c3b37c8148247e08e9ff8b`. The live panel of five pinned models from two families passed the text, and the buyer opened it (64 words).
- **Doc gaps closed** [measured, the diff]: `ref/intake.txt` says what `from` holds (free text, unchecked, no secrets), where `"offer"` goes (the proposal's top level, never in `terms` or the `crow-request`), what a checks-only deal's acceptance looks like (`"rubric": {"criteria": [], "passThreshold": 0}`, correct, not missing), and where the payout address comes from (the terms' `sellerPayoutAddress`, chosen by the seller, not on either card). `ref/after-funding.txt` says a trigger's deadline is checked against the block's timestamp, so a `reclaim` 2 s after `deliverBy` can answer 409 `TooEarly`.

## Handoff

(Filled in below.)
