# T-441: the benchmark's second permission mode, sandbox auto-allow

- **Lane:** test (agent access)
- **Phase:** 2 (roadmap stage 1, "Outsiders can use it")
- **Depends on:** T-412 (the benchmark harness, its six live records of 2026-11-14)
- **Paths this task may touch:** `tools/one-click/bench.mjs`, `tools/one-click/bench-live.mjs`, `tools/one-click/bench-record.mjs`, `tools/one-click/README.md`, `scripts/metrics/one-click-summary.mjs`, `scripts/metrics/schemas/one-click*.schema.json`, `tests/metrics/one-click*`, this file
- **Human gate:** yes for the live runs only (Rafa's key and Sepolia test funds), as in T-412
- **Status:** in progress
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

- [ ] `bench.mjs --live --permissions sandbox-auto` runs a scenario with sandbox auto-allow on and edits auto-accepted. `--permissions prompt` (the default) runs as before. `sandbox-auto` refuses `--unsandboxed`, and an unknown value is refused. Neither sends anything.
- [ ] The fences hold in both modes even when nothing prompts:
  - a PreToolUse hook denies a request that names this user's files, reads the environment, or uses a file tool outside the run's folders;
  - the sandbox unsets the agent key (`ANTHROPIC_API_KEY`) for every sandboxed command.
  - A test shows each.
- [ ] Every live record carries `agent.permissions` (`prompt` or `sandbox-auto`). The schema accepts it and still accepts the six records of 2026-11-14, which have no such field.
- [ ] The summary's `headline` counts `prompt` records only (a record without the field is a `prompt` record). A new `sandboxAuto` block holds the same four numbers from `sandbox-auto` records. A test shows a `sandbox-auto` record never moves `headline`.
- [ ] A `sandbox-auto` run writes to its own folder (`reports/scratch/one-click-bench/live-sandbox-auto/` by default), so the runbook's copy of `live/*.json` never picks one up.
- [ ] The raw log names a denied request as `denied`, not as a `permission_request`. This explains the log-vs-record gap of 2026-11-14.
- [ ] The README and the Handoff give Rafa the six live commands for the new mode, with a cost estimate and how it was made.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

- **The allowlist is the sandbox, not command patterns.** Permission rules such as `Bash(curl https://crow.direct/*)` match the command's text, so an agent that writes `cd docs && curl …` or runs its own script falls outside them and asks again. The OS sandbox fences what the command can do, whatever its text. That is the hard-constraints rule: a guardrail the agent cannot override, proved by tests that fail. The network and write limits are T-412's, unchanged.
- **Edits are auto-accepted** (`permissionMode: 'acceptEdits'`). An operator who lets sandboxed commands run unprompted has no reason to approve the scripts those commands run. The PreToolUse hook keeps file tools inside the run's folders.
- **The fences move to a PreToolUse hook.** In T-412 they lived in `canUseTool`, which Claude Code calls only when it would ask. An auto-allowed command never reaches it, so the hook now runs them on every call, in both modes. `canUseTool` keeps the same check as a second line.
- **The key is unset for sandboxed commands** (`sandbox.credentials.envVars`, mode `deny`), in both modes. In T-412 the regex denials and `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` (whether it is honoured was a guess) kept the key from the agent's commands. The sandbox setting does not depend on spotting the read.
- **`prompt` stays the headline.** The console's four numbers and the Steering row keep their meaning and their history. Whether the Steering target should move to `sandbox-auto` is Rafa's call once both modes have records.

## Handoff

(to fill in)
