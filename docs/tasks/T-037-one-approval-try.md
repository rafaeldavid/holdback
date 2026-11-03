# T-037: One-approval test deal from the homepage prompt (try.mjs)

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-027 (the agent docs site), T-030 (agent-ready API), T-029 (the operator fee)
- **Paths this task may touch:** `examples/try.ts`, `examples/try.test.ts`, `site/build.mjs`, `site/check.mjs`, `site/llms.txt`, `site/index.html` (generated), `site/try.mjs` (generated), `package.json` and `pnpm-lock.yaml` (rolldown pinned as a root devDependency), `eslint.config.js` (ignore the generated bundle), `vitest.config.ts` (cost table), `docs/plan.md` (the T-037 line), `docs/team.md` (Rules and checks), `docs/tasks/T-037-one-approval-try.md`
- **Human gate:** no for the PR; deploying `try.mjs` to escrow.stream is the coordinator's step after review
- **Status:** in progress
- **Agent/session:** implementer, worktree `agent-a744d5c4759c238f6`, branch `t-037-one-approval-try`

## Intent

Rafa's success criterion: a stranger types the homepage prompt "Run a test deal with https://escrow.stream" into a vanilla Claude Code (default permission mode, only Node installed) and approves at most one command, for the packages it needs, after which the deal runs end to end. Measured before this task: a vanilla Claude Code finished a deal in 246 s but would have asked for approval 14 times. It fetched with `curl`, wrote a Python client and ran one script per step.

So the try path becomes one reviewable script and one shell command:

- `examples/try.ts` runs one complete test deal against the live demo (`https://api.escrow.stream`, `https://api2.escrow.stream`) and plays both sides with fresh keys. It follows the `llms.txt` "Try it" steps: faucet both sides; the seller offers a checks-only dataset (3 rows of `customer_id,email` for 25 tUSD); the buyer checks the offer on both operators, then agrees and funds; the seller encrypts and delivers; it waits for the outcome and opens the buyer's copy. It reuses `examples/agent.ts` and `examples/verify.ts` (fetch, `viem`, `tweetnacl`; no `@holdback/*` package), so every prepared message is checked against the script's own intent before it is signed. It prints one short line per step and ends with the commitment ID and the final state. Any refusal exits non-zero with a clear message.
- `site/build.mjs` bundles it with rolldown into `site/try.mjs`: plain ESM, not minified, `viem` and `tweetnacl` left as imports. The publish build serves it at https://escrow.stream/try.mjs. `site/check.mjs` fails when the bundle is stale against `examples/`.
- The one command (`mkdir`, `npm install` of the two packages at exact versions, `curl` of `try.mjs`, a `shasum` check, `node try.mjs`) sits at the top of `llms.txt` "Try it" and in the homepage's agent line. The build fills in the sha256 and the versions, so they cannot drift from the bundle and the lockfile.
- A test runs `examples/try.ts`, and the bundle itself, against a local sim, so CI covers the path without network.

Non-goals: no change to the protocol, the API, `spec/schemas/` or the operator; no SDK or MCP server (API first); the step-by-step sections of `llms.txt` stay for agents that integrate by hand; no deploy (the coordinator deploys after review); no private-deal or judged-panel path in the script (checks-only only).

Mid-task addition (coordinator, from a second stranger trial that finished in about 8 minutes and 18 tool calls): fix the cheap `llms.txt` gaps it hit. Spell out the offer's `submit.body` shape; say which fields each step's body repeats; document the response of `GET /v1/commitments/<id>/terms` and where the seller's signature sits; name the events' type field; make the homepage's agent line carry the one command as plain text. Verify each against the code or the live API before writing it.

## Context

- `site/llms.txt` "Try it", sections 4 to 8; `docs/api.md`.
- `examples/agent.ts`, `examples/verify.ts`: the HTTP-only agent and the verify-before-sign checks (T-020, T-024, T-030).
- `site/build.mjs`, `site/check.mjs` (T-027); `apps/site/wrangler.jsonc` serves `reports/site-out`.
- `examples/examples.test.ts`: how examples run against a sim in CI.
- CLAUDE.md "API first, no SDK or MCP"; D31, D32, D39.

## Acceptance criteria

- [ ] `examples/try.ts` completes a deal against a local sim in a vitest test (`examples/try.test.ts`), runs no `@holdback/*` import, and prints one line per step plus the final commitment ID and state.
- [ ] A refusal (an offer that is not the one the buyer agreed to) exits non-zero with a message that names what differed; shown by a test.
- [ ] `site/try.mjs` is the rolldown bundle of `examples/try.ts`: ESM, not minified, `viem` and `tweetnacl` external. `node site/build.mjs` writes it; `--out DIR` copies it into the publish build; `site/check.mjs` fails when it is stale; a vitest test fails when it is stale (CI does not run `site/check.mjs`).
- [ ] The bundle itself runs a deal against the local sim in the test.
- [ ] The one command is the first thing under "Try it" in `llms.txt` and in the homepage's agent line, with exact versions from the lockfile and the sha256 of `site/try.mjs` filled in by the build (`{{TRY_SHA256}}`, `{{VIEM}}`, `{{TWEETNACL}}` placeholders in `llms.txt`).
- [ ] The one command, run for real in an empty folder against the live demo, completes a deal (output in Evidence).
- [ ] The coordinator's `llms.txt` gaps (1) to (5) fixed and checked against code or the live API; anything left is listed in the PR body.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `node site/build.mjs`, `node site/check.mjs` and `pnpm verify` pass.

## Out of scope

- Deploying `try.mjs`, `llms.txt` or the homepage (the coordinator's step after review).
- Running `site/check.mjs` in CI (T-034's `site` job).
- An npm package or SDK.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

## Handoff
