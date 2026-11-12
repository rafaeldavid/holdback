# One-Click Escrow harness (T-066)

The harness measures what a fresh assistant needs to run one honest deal from the homepage prompt: the user approvals, the tokens and their cost at Opus 5.5 list prices, and where the time goes. It drives a fresh Claude Code through the Agent SDK and writes one run file, `one-click/<runId>.json`, that Crow Control reads (headline metrics 1 to 3). `outsider.mjs`, beside it, is T-328's harness for runs that start from `llms.txt` alone.

## What a run does

1. Reads the prompt from the live homepage's `#prompt` span (`https://crow.direct/`), and stops unless it starts "Run a test deal with Crow": every request it drives is approved.
2. Starts a fresh Claude Code in a new, empty temporary folder, with its own temporary folder and npm cache, default permissions, no settings files, no MCP servers and a filtered environment (`ENV_KEEP` in `metrics.mjs`): no Claude, Anthropic, SSH agent or cloud variable of this machine reaches it. Its Bash commands run in Claude Code's OS sandbox, as `outsider.mjs --sandbox` does: no reads of your documents, keys, dotfiles that hold logins or keychain, writes only in the run's folders, and network only to Crow's, npm's and Sepolia's hosts.
3. Answers every permission request with "allow" and counts it (`canUseTool`), except a request that names this machine's user's own files or logins (keys, `.env` files, the keychain, `gh`, `wrangler`, `git push`, `ssh`), which it denies and lists in `errors`. It answers a question card with its "yes" option and replies "Yes, go ahead." when the assistant stops to ask in the chat, up to `--max-replies` times. Each of these is an approval.
4. Records the effort the model ran at from a `PreToolUse` and a `Stop` hook (`input.effort.level`).
5. Stops when `try.mjs` reports the deal Released or Refunded, or at `--timeout-ms`.
6. Builds the run file with `metrics.mjs` (pure) and checks it against `scripts/metrics/schemas/one-click.schema.json`. A file that fails the check is kept as `<runId>.json.invalid`, so the console never reads it.

The run file keeps, for each approval, the tool and a scrubbed summary: a Bash command or a file path with quoted strings, option values that carry credentials, headers or bodies, `KEY=VALUE` pairs, 32-byte hex, emails, IP addresses, local paths and query strings removed; a fetched URL as origin and path; any other tool by name only. `--logs` keeps the raw messages, the assistant's text and command output included, so keep them outside git.

## Gates (Rafa decides, T-066 "Gates for Rafa")

- **Where it runs.** The harness approves tool requests as the user who runs it. The sandbox and the denials keep the assistant away from your files and logins; a separate macOS user, or a throwaway virtual machine, is the stronger fence, and the only one with `--unsandboxed`. It signs in with this Mac's Claude Code login only: the environment filter drops `ANTHROPIC_API_KEY`, so a CI run needs a change that passes a capped key on purpose (planned as T-068).
- **A schedule.** Each run costs model tokens at list price (the run file's `cost`), spends Sepolia test gas from the funding lane, takes one faucet mint, and counts against the test seller's per-address limits (`site/llms.txt`).
- **`--tail`** uses your Cloudflare login (`wrangler`) to count requests per Worker during the run.

## Use

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

## Why it sits outside the workspace

`package.json` pins `@anthropic-ai/claude-agent-sdk` exactly, with its own `package-lock.json`. The folder is not in `pnpm-workspace.yaml`, so `pnpm-lock.yaml` does not change and CI never installs the SDK. The tests (`tests/metrics/one-click.test.ts`) import `metrics.mjs`, which imports no SDK code, and run `run.mjs --dry-run`, which loads `scripted.mjs` in place of the SDK.
