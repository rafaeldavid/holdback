# T-037: One-approval test deal from the homepage prompt (try.mjs)

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-027 (the agent docs site), T-030 (agent-ready API), T-029 (the operator fee)
- **Paths this task may touch:** `examples/try.ts`, `examples/try.test.ts`, `examples/package.json` and `examples/tsconfig.json` (the demo-cloud world as a test devDependency), `site/build.mjs`, `site/check.mjs`, `site/llms.txt`, `site/index.html` (generated), `site/try.mjs` (generated), `package.json` and `pnpm-lock.yaml` (rolldown pinned as a root devDependency), `eslint.config.js` (ignore the generated bundle), `vitest.config.ts` (cost table), `docs/plan.md` (the T-037 line), `docs/team.md` (Rules and checks), `docs/tasks/T-037-one-approval-try.md`
- **Human gate:** no for the PR; deploying `try.mjs` to escrow.stream is the coordinator's step after review
- **Status:** done (PR 114)
- **Agent/session:** implementer, worktree `agent-a744d5c4759c238f6`, branch `t-037-one-approval-try`

## Intent

Rafa's success criterion: a stranger types the homepage prompt "Run a test deal with https://escrow.stream" into a vanilla Claude Code (default permission mode, only Node installed) and approves at most one command, for the packages it needs, after which the deal runs end to end. Measured before this task: a vanilla Claude Code finished a deal in 246 s but would have asked for approval 14 times. It fetched with `curl`, wrote a Python client and ran one script per step.

So the try path becomes one reviewable script and one shell command:

- `examples/try.ts` runs one complete test deal against the live demo (`https://api.escrow.stream`, `https://api2.escrow.stream`) and plays both sides with fresh keys. It follows the `llms.txt` "Try it" steps: faucet both sides; the seller offers a checks-only dataset (3 rows of `customer_id,email` for 25 tUSD); the buyer checks the offer on both operators, then agrees and funds; the seller encrypts and delivers; it waits for the outcome and opens the buyer's copy. It reuses `examples/agent.ts` and `examples/verify.ts` (fetch, `viem`, `tweetnacl`; no `@holdback/*` package), so every prepared message is checked against the script's own intent before it is signed. It prints one short line per step and ends with the commitment ID and the final state. Any refusal exits non-zero with a clear message.
- `site/build.mjs` bundles it with rolldown into `site/try.mjs`: plain ESM, not minified, `viem` and `tweetnacl` left as imports. The publish build serves it at https://escrow.stream/try.mjs. `site/check.mjs` fails when the bundle is stale against `examples/`.
- The one command (`mkdir`, `npm install` of the two packages at exact versions, `curl` of `try.mjs`, a `shasum` check, `node try.mjs`) sits at the top of `llms.txt` "Try it" and in the homepage's agent line. The build fills in the sha256 and the versions, so they cannot drift from the bundle and the lockfile.
- A test runs `examples/try.ts`, and the bundle itself, against a local world, so CI covers the path without network. The world is the public demo's own (`apps/demo-cloud` `PublicWorld`, served in Node on two origins), because the bare sim's faucet grants tokens but no club mandate.

Non-goals: no change to the protocol, the API, `spec/schemas/` or the operator; no SDK or MCP server (API first); the step-by-step sections of `llms.txt` stay for agents that integrate by hand; no deploy (the coordinator deploys after review); no private-deal or judged-panel path in the script (checks-only only).

Mid-task addition (coordinator, from a second stranger trial that finished in about 8 minutes and 18 tool calls): fix the cheap `llms.txt` gaps it hit. Spell out the offer's `submit.body` shape; say which fields each step's body repeats; document the response of `GET /v1/commitments/<id>/terms` and where the seller's signature sits; name the events' type field; make the homepage's agent line carry the one command as plain text. Verify each against the code or the live API before writing it.

## Context

- `site/llms.txt` "Try it", sections 4 to 8; `docs/api.md`.
- `examples/agent.ts`, `examples/verify.ts`: the HTTP-only agent and the verify-before-sign checks (T-020, T-024, T-030).
- `site/build.mjs`, `site/check.mjs` (T-027); `apps/site/wrangler.jsonc` serves `reports/site-out`.
- `examples/examples.test.ts`: how examples run against a sim in CI.
- CLAUDE.md "API first, no SDK or MCP"; D31, D32, D39.

## Acceptance criteria

- [x] `examples/try.ts` completes a deal against a local world in a vitest test (`examples/try.test.ts`), runs no `@holdback/*` import, and prints one line per step plus the final commitment ID and state.
- [x] A refusal (an offer that is not the one the seller asked for) exits 3 with a message that names what differed; shown by a test.
- [x] `site/try.mjs` is the rolldown bundle of `examples/try.ts`: ESM, not minified, `viem` and `tweetnacl` external. `node site/build.mjs` writes it; `--out DIR` copies it into the publish build and refuses a stale one; `site/check.mjs` fails when it is stale; a vitest test fails when it is stale (CI does not run `site/check.mjs`).
- [x] The bundle itself runs a deal against the local world in the test.
- [x] The one command is the first thing under "Try it" in `llms.txt` and in the homepage's agent line, with exact versions from the lockfile and the sha256 of `site/try.mjs` filled in by the build (one `{{TRY_COMMAND}}` placeholder in `llms.txt`; the shape lives once, in `tryCommand()` in `site/build.mjs`).
- [x] The one command, run for real in an empty folder against the live demo, completes a deal (output in Evidence).
- [x] The coordinator's `llms.txt` gaps (1) to (5) fixed and checked against code or the live API; what is left is listed in Handoff and the PR body.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `node site/build.mjs`, `node site/check.mjs` and `pnpm verify` pass.

## Out of scope

- Deploying `try.mjs`, `llms.txt` or the homepage (the coordinator's step after review).
- Running `site/check.mjs` in CI (T-034's `site` job).
- An npm package or SDK.

## Evidence

- **Measured: the one command, live.** Run in the empty folder `reports/scratch/try-run/` against https://api.escrow.stream and https://api2.escrow.stream, from `node_modules` that npm installed there (viem 2.57.13, tweetnacl 1.0.3), on 2026-11-03 at 09:19 UTC. Two departures from the published command: `try.mjs` was copied from `site/try.mjs` instead of curled (it is not deployed yet), and `npm init -y` ran without `>/dev/null` (this session allows no redirects; it only prints `package.json`). npm's cache pointed inside the worktree (`npm_config_cache`). `shasum -a 256 -c` printed `try.mjs: OK`, then:

  ```
  ’crow test deal on https://api.escrow.stream and https://api2.escrow.stream: test tUSD only, nothing here is real money
  keys      buyer 0x96ebee…8662, seller 0x954b76…367d: fresh keys, held in memory only
  faucet    1000 tUSD each, both admitted to demo-club
  offer     0x75dc64…39bd Offered: 3 rows of customer_id,email for 25 tUSD, checks cols, rows, uniq
  accepted  AcceptedByAdjudicator on every operator: the primary adjudicator 0xc0684d…e679 takes the deal
  check     the buyer: same terms on every operator, ID recomputed, seller's signature recovers; price, checks and adjudicators as agreed
  fund      Held: 26 tUSD held (25 price + 1 adjudication fee), operator fee 0.01 tUSD
  deliver   Delivered: 103 encrypted bytes, the key sealed to 3 adjudicators and the buyer
  outcome   Released: checks cols pass, rows pass, uniq pass; decision accept
  open      the buyer decrypted its copy, sha256 checked: 3 rows, 1,ada@example.com | 2,alan@example.com | 3,grace@example.com
  balances  buyer 973.99 tUSD, seller 1025 tUSD
  final     Released in 4 s; final at 2026-11-03T09:20:19Z, when the 60 s appeal window closes, with nobody needing to act
  done      commitment 0x75dc64c021e1b1cdbad85be25f499e560403c3ce41be476574b4e9431e6639bd Released
  ```

  Exit 0. `GET /v1/commitments/0x75dc…39bd` on op1 then read `Released`, balances 973990000 and 1025000000.
- **Measured: the one command** after review (sha256 of `site/try.mjs` `fc0467259c3a14fa8026cdfb6e248eda59f6cfdf0b900cbe5f7a6ac7cd6ad35e`; the live run above used the first bundle, `af0785be…6a25`, which differs only in the delivery-URI check):

  ```sh
  mkdir -p crow-try && cd crow-try && npm init -y >/dev/null && npm install --silent --ignore-scripts viem@2.57.13 tweetnacl@1.0.3 && curl -fsSLO https://escrow.stream/try.mjs && echo "fc0467259c3a14fa8026cdfb6e248eda59f6cfdf0b900cbe5f7a6ac7cd6ad35e  try.mjs" | shasum -a 256 -c && node try.mjs
  ```

  It heads "Try it" in the publish build's `llms.txt` and shows on the homepage under the Try line, in `<div class="cmd-box"><code>`.
- **Measured: review fixes.** `pnpm vitest run examples/try.test.ts`: 6 passed, adding the buyer's refusals: both operators serving raised terms ends `refused at check: refusing to agree: the terms the operators serve are not the ones the seller sent`, exit 3; one operator doing so ends `stopped at check: operators disagree on /v1/commitments/…/terms; do not proceed`, exit 1. `pnpm typecheck` and ESLint on the changed files pass; `node site/check.mjs` passes.
- **Measured: tests.** `pnpm vitest run examples/try.test.ts`: 4 passed in 11.5 s (a deal from `try.ts` and one from the bundle piped into `node --input-type=module`, each against the demo-cloud world on two origins with the 1 bp fee; an operator raising the prepared price is refused with exit 3 and `refused at offer: refusing to sign: body.price.amount differs from what you asked for`; the bundle is fresh and imports only `viem`, `viem/accounts` and `tweetnacl`; the command carries the sha256 and the versions pnpm installed).
- **Measured: drift is caught.** With one character of `site/try.mjs` changed, `node site/check.mjs` exited 1 with three FAILs (index.html stale, try.mjs stale, the agent line's command), and `node site/build.mjs --op1 … --out …` refused. Rebuilding restored the same sha256: three builds gave `af0785be…6a25` (deterministic).
- **Measured: the bundle.** 64,484 bytes, 1,629 lines of plain ESM; banner, then `examples/verify.ts`, `examples/agent.ts`, `examples/try.ts` regions.
- **Measured: the `llms.txt` fixes against the live API.** The live `/terms` of that deal is the bare terms with `deliverable` and `acceptance` in full, RFC 3339 times, `appealWindowSec`, `appealDecideSec` and `maxSubmissions` as numbers, no dispute fields, plus `id` and `signatures.seller`. Live `/events` items carry `seq`, `type`, `commitmentId`, `at`, `actor`, `submittedVia`, `payload`, `prevHash`, `hash`, newest first. The agree and delivery bodies: the live run's `verifyPrepared` compared each operator body field for field with the body `verify.ts` builds (the shapes now in section 4) and found no difference.
- **Measured: sizes.** `site/llms.txt` 48,918 to 52,157 bytes; the publish build's 52,454.
- **Inferred: one approval.** The command is one compound Bash command, which Claude Code's default mode approves once. Not measured with a stranger until deploy; fetching escrow.stream may ask for its own WebFetch approval (guessed).
- **Measured: `pnpm verify`** at `5b300f6` (only this task file uncommitted), 2026-11-03T09:30Z: PASS, every step (typecheck, lint, forge build, forge test, test with 94 files and 2,230 tests, spec, snap, snap:local, demo); `reports/verify-t-037-one-approval-try.md`. An earlier full `pnpm test` on this branch, run while a recursive submodule clone and other agents' builds held the load average above 100 on 8 cores, had 12 tests in 6 untouched files time out at 5 s; they passed in this run. PR 114's CI passed every job (static, four test shards, contracts, formal, gitleaks, check).
- **Measured:** `node site/build.mjs` and `node site/check.mjs` pass; the publish build (`--out reports/site-out`) writes `try.mjs` and passes the check.
- Snapshot diffs: none (no fixture touched; `pnpm snap` 32 passed, 0 failed).

## Decisions

- **Test against the demo's own world, not the bare sim.** The sim's faucet grants tokens only, so a fresh key has no mandate and cannot offer. `apps/demo-cloud`'s `PublicWorld` is the code the live nodes run (faucet with mandate, the 1 bp operator fee, 60 s minimum windows); the test serves it on two origins as `apps/demo-cloud/src/world.test.ts` does. Cost: `@holdback/demo-cloud` becomes a devDependency of `examples/` (test only; `try.ts` still imports no workspace package).
- **rolldown pinned as a root devDependency (1.2.15).** It was only vite's dependency, which pnpm's isolated layout does not expose to `site/build.mjs`. Same version the lockfile already resolved; no download.
- **One placeholder, one source for the command.** `{{TRY_COMMAND}}` in `llms.txt`; `tryCommand()` in `site/build.mjs` builds it from the sha256 of `site/try.mjs` and the versions the lockfile resolves for `examples/`. The homepage takes the same string. Rejected: three placeholders (`{{TRY_SHA256}}`, `{{VIEM}}`, `{{TWEETNACL}}`) inside a command spelled out in `llms.txt`, which would keep the shape in two places.
- **Publish only the committed bundle, only while current.** `--out` refuses when `site/try.mjs` differs from a fresh bundle and copies the committed file, so the published sha256 is always that of the published file.
- **The buyer's checks live in `try.ts`.** `Agent.agreeAndFund` takes no expected price, so `try.ts` checks the offer itself before funding: identical terms on every operator, the recomputed ID, the seller's signature, then buyer, key, price, club, deliverable, acceptance, adjudicators and the fee field by field. `agent.ts` and `verify.ts` are unchanged.
- **"Calls only the two operators" is enforced.** The seller refuses a ciphertext URI on another host; before the buyer fetches the ciphertext, every operator must record the seller's URI in its `delivery.submitted` event. It writes no files at all.
- **Exit codes:** 0 Released, 3 a refusal to sign (as `sign.ts`), 1 anything else.
- **The command is visible on the homepage** (Rafa, 2026-11-03): under the Try line, labelled "For an AI agent that can run commands, such as Claude Code.", with its own copy icon. The off-screen lines around it tell an agent what it is.
- **`npm install --ignore-scripts`.** Neither package needs an install script. The pins fix viem and tweetnacl; their own dependencies resolve afresh on the stranger's machine (ox declares `^` ranges). Publishing a lockfile or bundling viem would pin those too; not done.
- **ESLint skips `site/try.mjs`.** Bundling drops line comments, including `eslint-disable-line`; its sources are linted.

## Handoff

Done: the script, its bundle, the build and checks, the one command in `llms.txt` and on the homepage, the `llms.txt` fixes (1) to (5), tests, and a live run. Not deployed.

For the coordinator, after review and merge:

1. `node site/build.mjs --op1 https://api.escrow.stream --op2 https://api2.escrow.stream --out reports/site-out`, `node site/check.mjs`, then deploy `crow-site` as `docs/operations.md` says. `reports/site-out/try.mjs` is new in the output.
2. Check `curl -s https://escrow.stream/try.mjs | shasum -a 256` equals the sha256 in https://escrow.stream/llms.txt and on the homepage.
3. Re-run the stranger trial (vanilla Claude Code, default mode, "Run a test deal with https://escrow.stream") and count approvals. Not measured here: the fetch of escrow.stream itself may ask for its own approval (a WebFetch domain permission), which this task cannot remove.

Left from the coordinator's list:

- (6) `llms.txt` is longer, not shorter: 48,918 to 52,157 bytes in the source. The try path no longer needs it beyond its first 1.3 KB (the command sits at byte 1,239 of the published file). A short `llms.txt` with the full guide at `llms-full.txt` is a follow-up.
- (5) Done: the command is visible on the homepage (see Decisions).

Observed, not fixed (outside this task's paths): `Agent.envelopeMaterial` in `examples/agent.ts` takes `.at(-1)` of `/events`, which is newest first, so it picks the oldest `delivery.submitted`. Harmless while `maxSubmissions` is 1; fix before resubmission lands.

Merge note: PR 110 merged first; main is merged into this branch and the T-037 line uses its checklist format. PR 109 adds `license` to `package.json` near, but not on, this branch's devDependency line.

`docs/operations.md` needs no change: the site deploy steps already build with `--out`, which now writes `try.mjs` too.

Limits of the command: POSIX shells only (`mkdir -p`, `shasum`; Alpine, slim Debian and Ubuntu images, and minimal Fedora lack `shasum`, inferred); Node 22 measured, Node 20 untested; the faucet's 10 addresses per client per hour allow 5 runs an hour.
