# T-229: One approval from the homepage prompt (One-Click Escrow)

- **Lane:** site, demo
- **Phase:** 2 (beside T-037, the first one-approval test deal)
- **Depends on:** T-037 (the one command and `try.mjs`, PR 114), T-222 (Crow's test seller, which the command buys from)
- **Paths this task may touch:** `site/build.mjs`, `site/check.mjs`, `site/llms.txt` (the "Try it" paragraph only), `site/index.html` (generated), `examples/try.test.ts`; docs: `docs/decisions-today.md` (D51, new lines), `docs/plan.md` (this row, a new line in Phase 2), `docs/team.md` (one Rules and checks row), `docs/update-flow.md` (the examples-to-homepage row), this file
- **Human gate:** yes for the site deploy. Rafa approved it on 2026-11-05: "ship the two One-Click changes (trim llms.txt, and copy the command with the prompt)". Everything else is in the repository.
- **Status:** done (PR 209 merged; crow-site `4f049eb5` live since 2026-11-05, 15:58 UTC; 1 approval per deal in both modes, measured)
- **Agent/session:** implementer, worktree `.worktrees/one-click`, branch `t-229-one-click-homepage`

## Intent

Rafa's goal, One-Click Escrow (D51): an honest deal at published terms, with no price negotiation, goes through with one approval from the user when the agent has funds. On 2026-11-05 a fresh Claude Code needed 4 approvals to reach Released from the homepage prompt. Two of them came from `llms.txt` inviting the agent to fetch and read `try.mjs` first. One came from the homepage copying only a link to `llms.txt`.

This task makes two changes:

1. **The copy button copies the command.** The prompt says in plain sentences what the command does, gives the exact command `llms.txt` serves (the same `tryCommand()`, with its sha256), and names `llms.txt` as the full explanation without asking the assistant to read it first. The visible page still shows only the short line and the copy icon (Rafa, 2026-11-04). The line now reads "Copy the prompt here", because it no longer copies a docs link.
2. **"Try it" stops inviting a fetch.** The paragraph keeps the trust anchors: the SHA-256 pin that refuses any other file, and the source on GitHub (`examples/try.ts`, `agent.ts`, `verify.ts`).

Non-goals:

- A seller-first path: a visitor's agent that sells needs a standing test buyer (T-222's second slice, in `docs/backlog.md`). It is the next gap for "started by either side".
- Any change to `try.mjs`, the protocol, the API or the operators.
- Showing the command on the page again.
- The deploy itself; the coordinator runs it.

## Acceptance criteria

- [x] Test first: `examples/try.test.ts` and `site/check.mjs` fail while the hidden prompt lacks the exact `tryCommand()` on a line of its own, while the visible page shows the command or its sha256, and while "Try it" invites a fetch of `try.mjs` or loses the SHA-256 pin or the GitHub source.
- [x] The copy button copies the prompt below; `node site/build.mjs` and `node site/check.mjs` pass.
- [x] `llms.txt` "Try it" asks for no fetch before the command.
- [x] After the deploy: a fresh assistant reaches Released from the copied prompt with 1 approval, in both "allow once" and "always allow" modes (measured with the same harness).
- [x] `pnpm verify` runs; its report is read (Evidence: every step passed in one of two runs, and each failure passed on its rerun; after the review fix, a third run passed every step).

## Evidence

- **Before: 4 approvals per deal** [measured, 2026-11-05, by the coordinator session]. A fresh Claude Code 2.1.318, default permissions, no allowlist, given the homepage prompt verbatim, asked for 4 approvals in each of 2 runs ("allow once" and "always allow"). The 4: a `curl` of `llms.txt` (that build has no WebFetch tool); a second download of `try.mjs` into `/tmp` to read it; a `grep` of that copy for imports and network calls; the one command. Both runs reached Released, 92.8 s and 92.6 s after the start. Harness and logs: `/private/tmp/claude-501/-Users-rafa-Documents-escrow/5d96f464-3e9f-488a-8cd3-964dda80e0bc/scratchpad/one-click/` (`harness/run.mjs`, `logs/run-once.summary.json`, `logs/run-always.summary.json`). That folder belongs to one session and will be cleaned; the PR 209 reviewer read the files and found they match these numbers [measured by the reviewer]. Copies of `run.mjs` and both summaries now live in `docs/research/2026-11-05-one-click/` (`before-once.summary.json`, `before-always.summary.json`).
- **Causes** [inferred from those logs]: approvals 2 and 3 followed "Try it"'s line "To read it before you ask, fetch https://escrow.stream/try.mjs". Approval 1 followed from the homepage copying only a link. `llms.txt` is 74,633 bytes, so the assistant took extra steps to read it.
- **Test first** [measured, 2026-11-05, before the change]: `node site/check.mjs` exited 1 with "the Try line's prompt does not carry the current try command on a line of its own" and "\"Try it\" asks the agent to fetch try.mjs before the command". `vitest run examples/try.test.ts -t "homepage copies"` failed on `expect(prompt.split('\n')).toContain(command)`.
- **After** [measured]: `node site/build.mjs` rewrote `site/index.html` only; `site/try.mjs` is unchanged (sha256 `cc310963bb0833e0d23f8018eb4ea802db09fa05fbd9489020340d2be2eed832`). `node site/check.mjs` passes. The changed test passes. `site/llms.txt` went from 74,633 to 74,332 bytes.
- **The deal tests under load** [measured]: two full runs of `examples/try.test.ts` each had one deal test time out at 60 s (a different one each run), with the load average at 111 on 8 cores from other sessions. This task does not touch the deal path (`examples/try.ts`, `site/try.mjs`) [inferred]. The prompt test passed in both runs.
- **`pnpm verify`, two runs at `d776794`** [measured, 2026-11-05; report `reports/verify-t-229-one-click-homepage.md`; load average 70 to 111 on 8 cores]. Every step passed in at least one full run, and each failure passed on its own rerun. Neither failure touches a file this task changed [inferred].
  - Run 1 (14:55 UTC): typecheck, lint, forge (241 tests), test (120 files, 2,706 tests passed, 6 skipped), spec, snap (31), snap:local (28, 3 excluded until Phase 4) and demo passed. `forge build` failed while it cloned the contracts' nested submodules for the first time in this fresh worktree; `forge build --root contracts` then exited 0.
  - Run 2 (about 16:00 UTC): every step passed except `test`. One T-221 anvil test, `apps/demo-cloud/src/registration.anvil.test.ts`, threw "the rules redeployment moved". Alone, `vitest run` on that file passed (1 test, 119.9 s).
  - Snapshot diffs: none against HEAD.
- **`pnpm verify` after the review fix, at `9448316`** [measured, 2026-11-05 15:29 UTC; same report; load average 48 to 60 on 8 cores]. Every step passed in one run: typecheck, lint, forge build, forge (241 tests), test (120 files, 2,706 tests passed, 6 skipped; 164 s), spec, snap (31), snap:local (28, 3 excluded until Phase 4) and demo. Snapshot diffs: none against HEAD. The uncommitted change at that run was this file only, plus a nested submodule (`contracts/lib/commerce-payments/lib/spend-permissions`) that `forge build` checked out; this task does not touch it.
- **The clipboard fallback, after the PR 209 review** [measured, 2026-11-05]. Test first: `node site/check.mjs` exited 1 with "the .copied fallback must use white-space: pre-wrap, or a hand copy breaks the command's hash check". After the change to `pre-wrap` and `node site/build.mjs`, it exits 0; `site/try.mjs` is unchanged (same sha256). In the Claude desktop browser pane, on the built `site/index.html` (loaded as a static snapshot, so the fallback's two steps, set the text and select it, ran from the console), the selection keeps 4 line breaks (the source has 4), its command line equals the source's, and it keeps both spaces before `try.mjs`.
- **The deploy** [measured, 2026-11-05]. On Rafa's go-ahead of 2026-11-05 ("ship the two One-Click changes (trim llms.txt, and copy the command with the prompt)"), a deploy session built the site from PR 209's merge commit `43f8067` and deployed crow-site `4f049eb5-34fb-4a59-843a-bd3855aaea19` at 15:58 UTC. It deployed only after main recorded T-228's operators as live (15:57 UTC), because this build's `llms.txt` carries T-228's line on closing a deal behind the chain by its timeout. The live homepage and `llms.txt` match the build byte for byte, the hidden `#prompt` carries the prompt below, and `https://escrow.stream/try.mjs` still has sha256 `cc310963…d832`, the one the command names. Nothing was rolled back; the rollback target is crow-site `704bd295` (`docs/operations.md`).
- **After: 1 approval per deal, in both modes** [measured, 2026-11-05, about 16:00 to 16:06 UTC]. The same harness, the same Claude Code 2.1.318 and model (`claude-opus-5-5`), default permissions, no allowlist, each run in a new empty folder, given the live `#prompt` text verbatim:

  | Mode | Tool approvals | Chat approvals | Total | Released, from the start | The deal alone (try.mjs) | Final state |
  | --- | --- | --- | --- | --- | --- | --- |
  | Allow once, before | 4 | 0 | 4 | 92.8 s | 63 s | Released |
  | Always allow, before | 4 | 0 | 4 | 92.6 s | 61 s | Released |
  | Allow once, after | 1 | 0 | 1 | 79.2 s | 63 s | Released |
  | Always allow, after | 1 | 0 | 1 | 106.2 s | 52 s | Released |

  - **The one approval** in each run was the assistant's first and only tool call: Bash, the command from the prompt with `node --version &&` put in front. Neither run fetched `llms.txt` or `try.mjs` before it, and neither asked anything in chat.
  - **Allow once:** commitment `0xc226f4cf3f1ad83c3677fe348b865086d6b018752393a2213407273b94b19db1`, Released with Crow's test seller as the other party, decision accept. On Sepolia Etherscan: [funded](https://sepolia.etherscan.io/tx/0x0fe86d6d1d0c931c4dad6bb19bbc31c8c16333cb3789160575dc6363e3832ecc), [delivered](https://sepolia.etherscan.io/tx/0xfc45b7a594bae4437221967fc73e368ecffe0b982c61d631e1f5be52caf3dd6a), [decided](https://sepolia.etherscan.io/tx/0xc438bf7e13b1b5cb58c0fb8bdcdec10632dbc5d072354deaa174b5f43816e995).
  - **Always allow:** commitment `0xe480d0205d8a6b1aa3381ef315aa97d15bad3b50cb5fef045c153f30971a9ea0`, Released with Crow's test seller, decision accept. On Sepolia Etherscan: [funded](https://sepolia.etherscan.io/tx/0xb4170cd80491925cf1bb15827a1015a7786110c8debcc496cb6c02a01840f2d0), [delivered](https://sepolia.etherscan.io/tx/0x84bfae322742334234ff0e1663b62153cec99a63c0953d34c66777b270a5bdb4), [decided](https://sepolia.etherscan.io/tx/0xc221eb796773247fce9c065b45e8d34da8b9d43c63d3e777df4fe8972474fde4).
  - **Time to Released** moved both ways: 79.2 s and 106.2 s against about 93 s before. The deal alone took 52 s to 63 s in all four runs, so the spread sits in `npm install`, the download and the assistant's turns, not in the approvals [inferred].
  - **The harness's label:** `run.mjs` keeps this morning's link-only prompt in `EXPECTED_PROMPT`, so its log says the live prompt "DIFFERS from expected". The constant only labels the log; the harness sends whatever the live `#prompt` holds, and that text matched the build [measured].
  - **Files:** `docs/research/2026-11-05-one-click/` holds `run.mjs` and the four summaries (`before-*` and `after-*`). The raw `.jsonl` logs stay in the session scratchpad. The committed `run.mjs` differs from the one that ran in one console line: it no longer prints the SDK's `apiKeySource` label ("none" in every run), which CodeQL flagged as a logged secret.

The prompt the button copies (the sha256 changes whenever `site/try.mjs` does):

```text
Run a test deal with Crow, escrow for AI agents, by running this command as written. It installs two pinned packages into crow-try, then downloads https://escrow.stream/try.mjs and runs it only if its SHA-256 matches the one in the command. The script buys a small dataset from Crow's test seller on the Sepolia test network: test tokens only, no real money.

mkdir -p crow-try && cd crow-try && npm init -y >/dev/null && npm install --silent --ignore-scripts viem@2.57.13 tweetnacl@1.0.3 && curl -fsSLO https://escrow.stream/try.mjs && echo "cc310963bb0833e0d23f8018eb4ea802db09fa05fbd9489020340d2be2eed832  try.mjs" | shasum -a 256 -c && node try.mjs --seller https://escrow.stream/agents/test-seller

It needs Node 20 or later and npm. The full explanation is at https://escrow.stream/llms.txt.
```

## Decisions

- **One source for the command.** `page(md, command = tryCommand())` builds the prompt from the same `tryCommand()` that fills `{{TRY_COMMAND}}` in `llms.txt`, so the page and the guide cannot carry different commands. `site/index.html` now changes whenever `site/try.mjs` does; `node site/build.mjs` already writes both.
- **The command sits on a line of its own** in the prompt, so an assistant can lift it whole. The checks look for that exact line.
- **The clipboard fallback keeps the command byte for byte.** Where the browser refuses the clipboard, the page shows the prompt selected for a hand copy. `.copied` sets `white-space: pre-wrap`, which keeps the line breaks and the two spaces in `echo "<sha256>  try.mjs" | shasum -a 256 -c`. The first version used `pre-line`, which collapsed those spaces to one, and `shasum` then refused the line (PR 209 review). `site/check.mjs` now fails if the rule is anything but `pre-wrap`.
- **The off-screen line for agents stays.** It still says where the command and its explanation live, and it is accurate.

## Handoff

Done on 2026-11-05, on Rafa's approval of the same day. The three steps for the coordinator all ran (Evidence: "The deploy" and "After"):

1. PR 209 merged, and `crow-site` `4f049eb5` deployed from its merge commit as `docs/operations.md` says.
2. `https://escrow.stream/try.mjs` hashes to the sha256 in the homepage's copied prompt and in `https://escrow.stream/llms.txt`.
3. The harness ran once in each mode: 1 approval per deal in both. `run.mjs` and the four summaries are in `docs/research/2026-11-05-one-click/`.

Next gap: a seller-first path. A visitor's agent that sells needs Crow's standing test buyer (T-222's second slice, `docs/backlog.md`).

Observed, not fixed (outside this task's paths): under a load average near 100 on 8 cores, `apps/demo-cloud/src/registration.anvil.test.ts` failed once with "the rules redeployment moved", and the deal tests in `examples/try.test.ts` timed out at 60 s twice. Each passed when run alone or in another full run. If they recur in CI, they belong on T-049's Known flakes list.
