# One-Click Escrow harness (T-066) and the benchmark harness (T-412)

Two harnesses share this folder. `bench.mjs` (T-412, roadmap B1) runs the six outsider scenarios of stage 1 and writes one record per run; its section comes first. `run.mjs` (T-066) runs the homepage prompt and is described after it. `outsider.mjs` is T-328's first outsider runner, kept as it ran; `bench.mjs --live` replaces it for new runs.

## The benchmark harness: `bench.mjs`

**One command runs one scenario and writes one record.** Scripted runs need no key and no network beyond this machine, and CI runs all six (`tests/metrics/one-click-bench.test.ts`). Live runs drive a fresh Claude Code on Sepolia and spend a model key, so Rafa starts them.

```
node tools/one-click/bench.mjs --scenario s1                  # scripted: about 3 s
node tools/one-click/bench.mjs --scenario all                 # scripted, the six in turn: about 11 s
node tools/one-click/bench.mjs --scenario s1 --live           # live: needs HOLDBACK_AGENT_ANTHROPIC_API_KEY
node tools/one-click/bench.mjs --scenario s1 --live --permissions sandbox-auto   # live, as an operator runs it (T-441)
node scripts/metrics/one-click-summary.mjs --runs reports/scratch/one-click-bench/live --out reports/scratch/one-click-summary.json
```

Run `pnpm install` and `pnpm build` once first (the scripted world imports the built operator). A live run also needs `npm ci --ignore-scripts --prefix tools/one-click` once, for the pinned Agent SDK.

### The six scenarios (`scenarios.mjs`)

| ID | Scenario | Ends | Other party | Scripted run |
| --- | --- | --- | --- | --- |
| s1 | A dataset under checks the buyer chooses | Released | the test seller | `examples/try.ts --seller` |
| s2 | Rubric-judged written work | Released | the test seller | blocked: no rubric item (N70) |
| s3 | A deal the seller starts | Released | the test buyer | `scripted/sell-to-buyer.ts` |
| s4 | A delivery that fails the checks | Refunded | the test seller | `examples/try.ts --seller --outcome refund` |
| s5 | A missed deadline; the buyer reclaims | Refunded | the test seller | blocked: no outcome that never delivers (N70) |
| s6 | A robot's data log checked against an agreed format | Released | the test buyer | `scripted/robot-log.ts` |

### What a scripted run is

A scripted run plays the scenario with no model and no person. `bench-local.mjs` serves the public demo's own world (the code the live operators run, on SimChain) and Crow's test seller or test buyer (the code the live test agents run) on 127.0.0.1, in this process. The scenario's script then runs in its own Node process as a plain HTTP client, with a fetch probe that counts its calls. The run succeeds only if the deal reaches the scenario's end state with Crow's test agent as the other party: if `try.ts` falls back to playing both sides, the run fails.

So a scripted record proves the harness and the scenario's path through today's code. It says nothing about whether a model can do the deal from the docs. It is marked `"mode": "scripted"`, it is written to `reports/scratch/one-click-bench/scripted/` by default, and the summary never takes a headline number from it.

### What a live run is

A live run gives a fresh Claude Code one sentence of goal (the scenario's `goal`, naming `https://crow.direct/llms.txt`) and nothing else about Crow, as T-328 did:

- an empty folder, no settings files, no MCP servers and a filtered environment;
- Claude Code's OS sandbox around its Bash commands by default: writes only in its folders, no reads of this user's main folders, shell history and rc files, network only to Crow's, npm's and Sepolia's hosts, and the agent key unset for every sandboxed command;
- file tools (Read, Write, Edit, Glob, Grep and the rest) only inside the run's two folders, since the OS sandbox fences Bash only;
- every permission request answered "allow" and counted;
- a request that names this user's files or logins, reads the environment, or points a file tool outside the run's folders denied on every call, prompted or not (a PreToolUse hook), and listed in `errors`; the raw log names it `denied`;
- a question card answered with its "yes" option, and "Yes, go ahead." when a turn ends with a question, up to `--max-replies` times; each counts as an approval.

The goal also asks the agent to write a `GUESS:` line whenever the docs leave it unsure. Those lines are the record's `docGaps`.

**Two permission modes** (T-441), set by `--permissions`:

| Mode | What asks a person | Records go to | Fills |
| --- | --- | --- | --- |
| `prompt` (the default) | every Bash command and file edit: Claude Code's default mode | `reports/scratch/one-click-bench/live/` | the summary's `headline` |
| `sandbox-auto` | only what the OS sandbox cannot hold: Bash runs unprompted inside it, file edits in the run's folders are accepted; other tools, question cards and chat replies still ask | `reports/scratch/one-click-bench/live-sandbox-auto/` | the summary's `sandboxAuto` |

`sandbox-auto` is how a careful operator runs an unattended agent: the OS sandbox, not a list of allowed command texts, is what keeps it to Crow's, npm's and Sepolia's hosts and its own folder. It needs the sandbox, so it refuses `--unsandboxed`. Each live record names its mode in `agent.permissions`; a record from before T-441 has none and counts as `prompt`.

**The key.** The run reads `HOLDBACK_AGENT_ANTHROPIC_API_KEY`, the agents' own key that `tools/duet` also uses, never the judges'. Without it the run stops before it imports the SDK or sends anything. The key reaches only the SDK's Claude Code process, as `ANTHROPIC_API_KEY`. It is never printed, and every string the harness writes (the record, and the raw log with `--logs`) passes through `scrubSecrets()` first. The sandbox unsets the key for every sandboxed command (`sandbox.credentials.envVars`, T-441), and the harness also denies the commands that read the environment in plain sight (`printenv`, `env`, `ps e`, `process.env`, `os.getenv`, `$ANTHROPIC…`). With `--unsandboxed` only the denials remain, so a dedicated, spend-capped key, rotated after the runs, stays the last fence. The record's gaps name the key source Claude Code reported, so a run billed to another login shows.

| Option (live) | Default | What it does |
| --- | --- | --- |
| `--model` | `claude-opus-5-5` | The model the agent runs |
| `--effort` | `medium` | The SDK's effort level |
| `--permissions` | `prompt` | `prompt` or `sandbox-auto` (above) |
| `--max-replies` | 4 | Chat replies before the harness stops answering |
| `--timeout-min`, `--idle-min` | 40, 5 | The whole run's limit, and the idle limit after a turn ends with background work |
| `--unsandboxed` | off | Runs the agent's commands without the OS sandbox: only as a separate user or in a throwaway virtual machine |
| `--logs <dir>` | none | Keeps the SDK's raw messages, scrubbed; outside the repository or under `reports/` |
| `--out <dir>` | `reports/scratch/one-click-bench/live` | Where the record goes (`.../live-sandbox-auto` with `--permissions sandbox-auto`, `.../scripted` for scripted runs) |

Exit codes: 0 when every record is valid and every scenario that can run reached its end state; 1 otherwise; 2 when the run could not start.

### What a record means (`crow.metrics.one-click/2`)

One file per run, `<runId>.json`, checked against `scripts/metrics/schemas/one-click.schema.json` before it gets its name; a file that fails stays as `<runId>.json.invalid`.

| Field | Meaning | Source |
| --- | --- | --- |
| `mode` | `scripted` or `live` | the command line |
| `agent.permissions` | a live run's permission mode, `prompt` or `sandbox-auto`; absent before T-441, read as `prompt` | `--permissions` |
| `outcome.success` | the deal reached the scenario's end state | scripted: the script's last `done` line, confirmed by the operator's `escrowState`; live: the operators' `escrowState` for the commitment the agent called most in its own API calls |
| `outcome.state` | `Released`, `Refunded`, `stopped`, `timedOut` or `blocked` (with `blockedBy`) | as above |
| `approvals` | what a person would have answered: tool permissions, question cards, chat replies | the harness's own count |
| `tokens` | `in` (input, cache writes and reads) and `out`, and each model's split | the last SDK result message, taken as the session's running total (a gap line says so when a run had several) |
| `cost.usdMicros` | each model's tokens at its own price in `config/model-prices.json`, in micro-USD | integer arithmetic; null if a model has no price |
| `cost.sdkReportedUsdMicros` | the SDK's own `total_cost_usd`, as a cross-check; a gap line flags a difference over 5 percent | the last result message |
| `time.withoutUserMs` | wall time less the time spent waiting on an approval: processing time that is not user delay | the harness's clock |
| `apiCalls` | calls by host and status, and Crow's 4xx and 5xx by route; model vendors and npm left out | the fetch and curl probes (`probes.mjs`) |
| `errors` | what stopped or slowed the run, scrubbed | the harness |
| `docGaps` | each place the agent had to guess | the `GUESS:` lines in the agent's own words, never in a tool result |

**The summary** (`scripts/metrics/one-click-summary.mjs`, `crow.metrics.one-click-summary/1`) turns the records into the four headline numbers: approvals per deal, tokens per deal (with the uncached input apart), time without the user and cost per deal. Each is the median of the newest 10 live records that reached their end state. With none, it reads `"state": "missing"` and `null`, never 0. `headline` counts `prompt` records only; `sandboxAuto` holds the same four numbers from `sandbox-auto` records, so the two modes never share a median.

### Rerun a scenario

Run the same command again: every run gets its own record, named by the time it started. The summary reads every record in the folders you give it.

### Add a scenario

1. Add an entry to `SCENARIOS` in `scenarios.mjs`: an ID `s<n>`, a name, the one-sentence goal, the end state, the other party, and either its scripted agent (a script under `scripted/` that ends with `done      commitment <id> <state>`) or `blockedBy`, what is missing.
2. Add the ID to the patterns in `scripts/metrics/schemas/one-click.schema.json` (version 2: `runId` and `scenario.id`) and `one-click-summary.schema.json` (`byScenario`), and to `SCENARIO_IDS` in `scripts/metrics/one-click-summary.mjs`.
3. Add it to the test's list in `tests/metrics/one-click-bench.test.ts`, and run `pnpm exec vitest run tests/metrics`.
4. When a blocked scenario's need lands, replace `blockedBy` with its scripted agent; the test then expects it to complete.

## The homepage harness: `run.mjs` (T-066)

The harness measures what a fresh assistant needs to run one honest deal from the homepage prompt: the user approvals, the tokens and their cost at Opus 5.5 list prices, and where the time goes. It drives a fresh Claude Code through the Agent SDK and writes one run file, `one-click/<runId>.json`, that Crow Control reads (headline metrics 1 to 3). `outsider.mjs`, beside it, is T-328's harness for runs that start from `llms.txt` alone.

### What a run does

1. Reads the prompt from the live homepage's `#prompt` span (`https://crow.direct/`), and stops unless it starts "Run a test deal with Crow": every request it drives is approved.
2. Starts a fresh Claude Code in a new, empty temporary folder, with its own temporary folder and npm cache, default permissions, no settings files, no MCP servers and a filtered environment (`ENV_KEEP` in `metrics.mjs`): no Claude, Anthropic, SSH agent or cloud variable of this machine reaches it. Its Bash commands run in Claude Code's OS sandbox, as `outsider.mjs --sandbox` does: no reads of your documents, keys, dotfiles that hold logins or keychain, writes only in the run's folders, and network only to Crow's, npm's and Sepolia's hosts.
3. Answers every permission request with "allow" and counts it (`canUseTool`), except a request that names this machine's user's own files or logins (keys, `.env` files, the keychain, `gh`, `wrangler`, `git push`, `ssh`), which it denies and lists in `errors`. It answers a question card with its "yes" option and replies "Yes, go ahead." when the assistant stops to ask in the chat, up to `--max-replies` times. Each of these is an approval.
4. Records the effort the model ran at from a `PreToolUse` and a `Stop` hook (`input.effort.level`).
5. Stops when `try.mjs` reports the deal Released or Refunded, or at `--timeout-ms`.
6. Builds the run file with `metrics.mjs` (pure) and checks it against `scripts/metrics/schemas/one-click.schema.json`. A file that fails the check is kept as `<runId>.json.invalid`, so the console never reads it.

The run file keeps, for each approval, the tool and a scrubbed summary: a Bash command or a file path with quoted strings, option values that carry credentials, headers or bodies, `KEY=VALUE` pairs, 32-byte hex, emails, IP addresses, local paths and query strings removed; a fetched URL as origin and path; any other tool by name only. `--logs` keeps the raw messages, the assistant's text and command output included, so keep them outside git.

### Gates (Rafa decides, T-066 "Gates for Rafa")

- **Where it runs.** The harness approves tool requests as the user who runs it. The sandbox and the denials keep the assistant away from your files and logins; a separate macOS user, or a throwaway virtual machine, is the stronger fence, and the only one with `--unsandboxed`. It signs in with this Mac's Claude Code login only: the environment filter drops `ANTHROPIC_API_KEY`, so a CI run needs a change that passes a capped key on purpose (planned as T-068).
- **A schedule.** Each run costs model tokens at list price (the run file's `cost`), spends Sepolia test gas from the funding lane, takes one faucet mint, and counts against the test seller's per-address limits (`site/llms.txt`).
- **`--tail`** uses your Cloudflare login (`wrangler`) to count requests per Worker during the run.

### Use

```
pnpm install                                               # once: Ajv for the schema check, from the root workspace
npm ci --ignore-scripts --prefix tools/one-click          # once: the pinned Agent SDK, outside the pnpm workspace
node tools/one-click/run.mjs --scenario buyer --effort medium --out reports/scratch/one-click
node scripts/metrics/check.mjs one-click reports/scratch/one-click/<runId>.json
```

| Option | Default | What it does |
| --- | --- | --- |
| `--scenario buyer\|seller` | `buyer` | `seller` exits with "Not measured yet": it needs Crow's test buyer (T-222, second slice) |
| `--effort <level>\|unset` | `medium` | Passed as the SDK's `Options.effort`. `unset` passes none, so the hooks record the default |
| `--model <id>\|unset` | `claude-opus-5-5` | Passed as `Options.model`; checked against the run file's model ID pattern at start |
| `--out <dir>` | `reports/scratch/one-click`, or `reports/scratch/one-click-dry` for a dry run | Where the run file goes |
| `--logs <dir>` | none | Keeps the SDK's raw messages as JSON lines; must be outside the repository or under `reports/` |
| `--tail` | off | Runs `npx wrangler@4 tail` on holdback-op1, holdback-op2 and crow-test-agents for the run, and keeps counts only: requests, and any CPU and wall time the events carry. No header, URL path or IP is kept (D39). A Worker whose tail never connected or exited early is left out with a gap line; with none connected, `cloudflare` is null |
| `--probe` | off | Asks only "Reply with the single word: ok" with no tools at all, and touches no Crow site; prints the effort the hooks saw |
| `--unsandboxed` | off | Runs the assistant's commands without the OS sandbox. Only as a separate user or in a throwaway virtual machine |
| `--dry-run <file>` | off | Plays a script (`scripted.mjs`) in place of the model: no SDK, no key, no network. `tests/metrics/fixtures/one-click-script.json` is the one CI runs |

### Why it sits outside the workspace

`package.json` pins `@anthropic-ai/claude-agent-sdk` exactly, with its own `package-lock.json`. The folder is not in `pnpm-workspace.yaml`, so `pnpm-lock.yaml` does not change and CI never installs the SDK. The tests (`tests/metrics/one-click.test.ts`) import `metrics.mjs`, which imports no SDK code, and run `run.mjs --dry-run`, which loads `scripted.mjs` in place of the SDK.
