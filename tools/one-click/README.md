# One-Click Escrow harness (T-066)

The harness measures what a fresh assistant needs to run one honest deal from the homepage prompt: the user approvals, the tokens and their cost at Opus 5.5 list prices, and where the time goes. It drives a fresh Claude Code through the Agent SDK and writes one run file, `one-click/<runId>.json`, that Crow Control reads (headline metrics 1 to 3).

## What a run does

1. Reads the prompt from the live homepage's `#prompt` span (`https://escrow.stream/`).
2. Starts a fresh Claude Code in a new, empty temporary folder, with default permissions, no settings files, no MCP servers and a filtered environment: no Claude or Anthropic variable of this machine reaches it.
3. Answers every permission request with "allow" and counts it (`canUseTool`). It answers a question card with its "yes" option and replies "Yes, go ahead." when the assistant stops to ask in the chat, up to 6 times. Each of these is an approval.
4. Records the effort the model ran at from a `PreToolUse` and a `Stop` hook (`input.effort.level`).
5. Stops when `try.mjs` reports the deal Released or Refunded, or after 10 minutes.
6. Writes the run file with `metrics.mjs` (pure) and checks it against `scripts/metrics/schemas/one-click.schema.json`.

## Gates (Rafa decides, T-066 "Gates for Rafa")

- **Where it runs.** The harness approves every tool request as the user who runs it, inside an empty folder. A separate macOS user, or T-039's VM, keeps it away from your files. In CI it needs an Anthropic API key the assistant's Bash could read, so use one you can afford to lose.
- **A schedule.** Each run costs about USD 0.18 to 0.20 at list price (measured at medium effort, the default), spends Sepolia gas from the funding lane, takes one faucet mint, and counts against the test seller's 3 requests per IP address an hour and 10 a day.
- **`--tail`** uses your Cloudflare login (`wrangler`) to count requests per Worker during the run.

## Use

```
npm ci --ignore-scripts --prefix tools/one-click          # once: the pinned Agent SDK, outside the pnpm workspace
node tools/one-click/run.mjs --scenario buyer --effort medium --out reports/scratch/one-click
node scripts/metrics/check.mjs one-click reports/scratch/one-click/<runId>.json
```

| Option | Default | What it does |
| --- | --- | --- |
| `--scenario buyer\|seller` | `buyer` | `seller` exits with "Not measured yet": it needs Crow's test buyer (T-222, second slice) |
| `--effort <level>\|unset` | `medium` | Passed as the SDK's `Options.effort`. `unset` passes none, so the hooks record the default |
| `--model <id>\|unset` | `claude-opus-5-5` | Passed as `Options.model` |
| `--out <dir>` | `reports/scratch/one-click` | Where the run file goes |
| `--logs <dir>` | none | Keeps the SDK's raw messages as JSON lines; must be outside the repository or under `reports/` |
| `--tail` | off | Runs `npx wrangler@4 tail` on holdback-op1, holdback-op2 and crow-test-agents for the run, and keeps counts only: requests, and any CPU and wall time the events carry. No header, URL path or IP is kept (D39) |
| `--probe` | off | Asks only "Reply with the single word: ok", denies every tool and touches no Crow site; prints the effort the hooks saw |

## Why it sits outside the workspace

`package.json` pins `@anthropic-ai/claude-agent-sdk` at exactly 0.3.318 with its own `package-lock.json`. The folder is not in `pnpm-workspace.yaml`, so `pnpm-lock.yaml` does not change and CI never installs the SDK. The tests (`tests/metrics/one-click.test.ts`) import only `metrics.mjs`, which imports no SDK code.
