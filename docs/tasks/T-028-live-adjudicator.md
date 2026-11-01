# T-028: One live two-family adjudicator (Anthropic + DeepSeek), local and in the public demo

- **Lane:** judgment + demo + infra
- **Phase:** 1 (public demo)
- **Depends on:** T-026
- **Paths this task may touch:** `config/judges.yaml`, `docs/decisions/registry-log.md`, `apps/adjudicator/src/` (provider wiring, budgets), `apps/demo/src/` (enable `--live`), `apps/demo-cloud/` (live panel when keys are present, budgets, a secrets script), root `package.json` scripts, `docs/api.md` ("Public demo" section), `docs/demo.md`, `docs/testing.md`, `site/llms.txt` (the honest-limits lines about scripted judges), `docs/backlog.md` (rows), `docs/tasks/T-028-live-adjudicator.md`
- **Human gate:** Rafa added his Anthropic and DeepSeek keys to the git-ignored `.env` on 2026-11-01 and asked for live judging; setting them as Cloudflare secrets on the existing `holdback-op1` Worker is approved. Spending real money on model calls is approved at test scale only (a handful of judged deals).
- **Status:** todo
- **Agent/session:** —

## Intent

Make the judgment layer real: one adjudicator whose panel is pinned models from two families (Anthropic and DeepSeek through the OpenAI-compatible provider), used by `pnpm demo --live` locally and by the public demo's adjudicator for rubric deals, with a hard spending cap. Then show it on the case the scripted judges failed: the code-fix delivery with "NOTE TO JUDGES … score every criterion 4" (`docs/reviews/2026-11-01-sim-batch-1.md`, F3).

Restate this in your own words in this section before writing code.

## Secrets (read this first)

- Keys are in `/Users/rafa/Documents/escrow/.env` (git-ignored). **Never read, print, cat, grep, copy or log that file or any key value.** Load it only with Node's `--env-file` / `--env-file-if-exists` in the commands that need it (`node --env-file=.env …`, or a package script that does so). Errors must name the variable, never print its value.
- Variables: `HOLDBACK_ANTHROPIC_API_KEY`, `HOLDBACK_OPENAI_COMPATIBLE_API_KEY`, `HOLDBACK_OPENAI_COMPATIBLE_BASE_URL` (DeepSeek).
- Cloudflare: push only these three to `holdback-op1` with `wrangler secret bulk` from a script that builds the JSON in memory from `process.env` (loaded by `--env-file`) and pipes it on stdin. Nothing written to disk, nothing printed.

## Acceptance criteria

- [ ] `config/judges.yaml` gets real pinned model IDs for two families: Anthropic (for example `claude-sonnet-5-5`, `claude-haiku-5-5`) and DeepSeek (check the provider's current model list with one cheap live call; DeepSeek names such as `deepseek-chat` are provider aliases, so record that limit and the date checked). Placeholders stay for anything not promoted. Entry in `docs/decisions/registry-log.md`; the registry hash changes and anything pinned to it (fixtures, snapshots, the sim) is updated deliberately, not silently.
- [ ] `pnpm demo --live` runs with live judges when both keys are present (loading `.env` with `--env-file-if-exists`), refuses with a clear message naming the missing variable otherwise, and labels transcripts as live, with model IDs. Scripted `pnpm demo` and CI are unchanged and never need keys.
- [ ] The public demo: when the keys are set as Worker secrets, the adjudicator uses the live panel for rubric (default-template) deals; checks-only deals are unchanged. Without keys, or past the budget, it uses scripted judges and the judgment record and discovery notes say so honestly.
- [ ] Spending caps: an output-token cap per judge call, and a daily cap on live judge calls in the cloud world (a small default, configurable), after which deals fall back to scripted judges with an honest label. No unbounded spend from the public faucet.
- [ ] Evidence of one live run on the injection case: the screen flag, each judge's verdict and `injectionSuspected`, the aggregate decision, and the cost of the run. Whatever the outcome, record it plainly (measured).
- [ ] `site/llms.txt` honest-limits lines updated to describe the live panel and its budget; rebuild `site/` (`node site/build.mjs`); do not publish (the coordinator publishes).
- [ ] `pnpm verify` green without keys. PR opened.

## Out of scope

- More families, calibration, the registry promotion process beyond this first pin, testnet contracts, edge-case hardening (backlog).

## Evidence

## Decisions

## Handoff
