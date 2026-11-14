# T-441: the benchmark's second permission mode, sandbox auto-allow

- **Lane:** test (agent access)
- **Phase:** 2 (roadmap stage 1, "Outsiders can use it")
- **Depends on:** T-412 (the benchmark harness, its six live records of 2026-11-14)
- **Paths this task may touch:** `tools/one-click/bench.mjs`, `tools/one-click/bench-live.mjs`, `tools/one-click/bench-record.mjs`, `tools/one-click/README.md`, `scripts/metrics/one-click-summary.mjs`, `scripts/metrics/schemas/one-click*.schema.json`, `tests/metrics/one-click*`, this file
- **Human gate:** yes for the live runs only (Rafa's key and Sepolia test funds), as in T-412
- **Status:** done (PR 563, merged 2026-11-14; the console reads both modes since crow-private PR 75)
- **Agent/session:** the session that landed T-412's live records, branch `t-441-bench-sandbox-auto`
- **Roadmap row:** B1
- **Change kind:** 4 (tool code with its tests): the metrics tests, `pnpm typecheck`, `pnpm lint`; one `reviewer` pass. It touches how the harness keeps the agent key from the agent, so the review asks the secrets questions by name.

## Intent

The live benchmark measures approvals with Claude Code in its default permission mode, where every Bash command and file write asks a person. On 2026-11-14 that gave a median of 11 approvals per deal. Real operators of an unattended agent rarely run that way. Rafa asked for the benchmark to be as real as possible (2026-11-14: "Absolutely yes, we want to aim the benchmark to be as real as possible").

Restated: add a second live mode, `--permissions sandbox-auto`, that runs the same scenarios the way a careful operator would. In this mode:

- Bash runs without a prompt inside Claude Code's OS sandbox, which allows network to Crow's, npm's and Sepolia's hosts only and writes only in the run's own folders.
- File edits inside those folders are accepted without a prompt.
- Everything else still asks and is counted.

Today's mode keeps its name, `prompt`, and stays the default. Its numbers stay comparable with the records of 2026-11-14. Each record states its mode, and the summary never mixes the two in one median.

Non-goals: running the live scenarios (Rafa's); the console's second row (crow-private `control/bench.mjs`, a follow-up named in the Handoff); changing the scenarios, the docs or `run.mjs`.

## Acceptance criteria

- [x] `bench.mjs --live --permissions sandbox-auto` runs a scenario with sandbox auto-allow on and edits auto-accepted. `--permissions prompt` (the default) runs as before. `sandbox-auto` refuses `--unsandboxed`, and an unknown value is refused. Neither sends anything.
- [x] The fences hold in both modes even when nothing prompts:
  - a PreToolUse hook denies a request that names this user's files, reads the environment, or uses a file tool outside the run's folders;
  - the sandbox unsets the agent key (`ANTHROPIC_API_KEY`) for every sandboxed command.
  - A test shows each.
- [x] Every live record carries `agent.permissions` (`prompt` or `sandbox-auto`). The schema accepts it and still accepts the six records of 2026-11-14, which have no such field.
- [x] The summary's `headline` counts `prompt` records only (a record without the field is a `prompt` record). A new `sandboxAuto` block holds the same four numbers from `sandbox-auto` records. A test shows a `sandbox-auto` record never moves `headline`.
- [x] A `sandbox-auto` run writes to its own folder (`reports/scratch/one-click-bench/live-sandbox-auto/` by default), so the runbook's copy of `live/*.json` never picks one up.
- [x] The raw log names a denied request as `denied`, not as a `permission_request`. This explains the log-vs-record gap of 2026-11-14.
- [x] The README and the Handoff give Rafa the six live commands for the new mode, with a cost estimate and how it was made.

## Evidence

All measured on 2026-11-14 in the worktree, on Node 22.22.2 and Agent SDK 0.3.318, unless labelled otherwise.

- **Tests:** `pnpm exec vitest run tests/metrics` passed: 11 files, 201 tests, 17 skipped (the two pitch-evidence files skip as on main). `pnpm typecheck` passes, and `pnpm exec eslint tools/one-click scripts/metrics tests/metrics` exits 0.
- **`one-click-permissions.test.ts` covers:**
  - each mode's session options;
  - the key unset for sandboxed commands in both modes;
  - the fence hook on 6 denied and 4 allowed calls;
  - a real symlink and absolute Glob patterns;
  - the options passed to `query()`;
  - the record field;
  - the summary's mode split;
  - each `--permissions` refusal.
- **The tests bite:**
  - With the hook made to allow everything, 6 of its tests failed.
  - The reviewer showed that the text-only path check let a symlink and an absolute Glob through. The new tests cover both.
- **The six records of 2026-11-14 are unchanged in effect:**
  - All six still validate.
  - The summary gives the same headline: approvals 11, tokens 680,590, time without the user 200,787 ms, cost 733,922 micro-USD.
  - The reviewer compared main's script and this branch's on all four: `headline`, `byScenario`, `runs` and `gaps` matched.
- **Not run:** no live run in either mode (Rafa's).
  - That `credentials.envVars` deny unsets the key at run time is the SDK's documented behaviour (sdk.d.ts, `envVars`), tested here as configuration only [inferred].
  - That Monitor's command runs under the Bash sandbox is inferred from the binary's strings, not verified. Its command still passes the fence.
- **Review** (one `reviewer` pass): ISSUES, 3 Medium, 5 Low, 2 Info. Each fixed finding has a test:
  - **Fixed, Medium:**
    - a symlink inside the run's folder, or an absolute Glob pattern, got a file tool past the fence. Paths are now resolved through `realpath`, and a Glob pattern that is a path is fenced too;
    - no test covered the wiring into `query()`. `queryOptions()` is now pure and tested;
    - this file and the README lacked the six commands and the cost estimate.
  - **Fixed, Low:**
    - `latestLive` names its mode;
    - a sandbox-auto deal with no cost gets its gap line;
    - `--out` may not put one mode's record in the other mode's folder;
    - an unknown mode throws instead of becoming `prompt`.
  - **Kept, Low:** Monitor stays enabled, since s5 used it on 2026-11-14 and taking it away would change the agent's path. Its command passes the fence.
  - **Kept, Info:** the key check stays before the mode check, which is safe. Prompt mode now denies a fenced call that never prompted, which counts no approval.

## Decisions

- **The allowlist is the sandbox, not command patterns.** Permission rules such as `Bash(curl https://crow.direct/*)` match the command's text, so an agent that writes `cd docs && curl …` or runs its own script falls outside them and asks again. The OS sandbox fences what the command can do, whatever its text. That is the hard-constraints rule: a guardrail the agent cannot override, proved by tests that fail. The network and write limits are T-412's, unchanged.
- **Edits are auto-accepted** (`permissionMode: 'acceptEdits'`). An operator who lets sandboxed commands run unprompted has no reason to approve the scripts those commands run. The PreToolUse hook keeps file tools inside the run's folders.
- **The fences move to a PreToolUse hook.** In T-412 they lived in `canUseTool`, which Claude Code calls only when it would ask. An auto-allowed command never reaches it, so the hook now runs them on every call, in both modes. `canUseTool` keeps the same check as a second line.
- **The key is unset for sandboxed commands** (`sandbox.credentials.envVars`, mode `deny`), in both modes. In T-412 the regex denials and `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` (whether it is honoured was a guess) kept the key from the agent's commands. The sandbox setting does not depend on spotting the read.
- **`prompt` stays the headline.** The console's four numbers and the Steering row keep their meaning and their history. Whether the Steering target should move to `sandbox-auto` is Rafa's call once both modes have records.

## Handoff

**Done:**
- the `sandbox-auto` mode;
- the fences on every call;
- the key unset in the sandbox;
- the record field and the summary's split;
- the README.

**Waits for Rafa: the six live runs in `sandbox-auto`.** They spend the agent key and Sepolia test funds: about USD 6 for the six (guessed from prompt mode's measured USD 5.94). From `/Users/rafa/Documents/escrow` on `main` after this merges, with `HOLDBACK_AGENT_ANTHROPIC_API_KEY` set (a dedicated, spend-capped key):

```
node tools/one-click/bench.mjs --scenario s1 --live --permissions sandbox-auto --logs reports/scratch/one-click-bench/logs
node tools/one-click/bench.mjs --scenario s2 --live --permissions sandbox-auto --logs reports/scratch/one-click-bench/logs
node tools/one-click/bench.mjs --scenario s3 --live --permissions sandbox-auto --logs reports/scratch/one-click-bench/logs
node tools/one-click/bench.mjs --scenario s4 --live --permissions sandbox-auto --logs reports/scratch/one-click-bench/logs
node tools/one-click/bench.mjs --scenario s5 --live --permissions sandbox-auto --logs reports/scratch/one-click-bench/logs
node tools/one-click/bench.mjs --scenario s6 --live --permissions sandbox-auto --logs reports/scratch/one-click-bench/logs
```

The records land in `reports/scratch/one-click-bench/live-sandbox-auto/`.

**The console** (crow-private PR 75) reads `agent.permissions`. It keeps its four numbers and the Steering measures on the prompt mode and shows `sandbox-auto` as a second set of rows. It also shows the medians by run date, the date the next run is due (4 days after the last), and a **Copy prompt: run the benchmark** button. The button copies crow-private `control/bench-prompt.txt`, which runs both modes and lands the records. The rows and the button reach readers with the next Worker deploy (Rafa's).

**Open:** whether the Steering target for approvals should move to `sandbox-auto` once both modes have records (Rafa's call).
