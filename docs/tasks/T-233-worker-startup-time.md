# T-233: the demo Workers start without compiling schemas

- **Lane:** infra
- **Phase:** 2, settlement on EVM (in focus under D53: stable EVM operations; the next operator deploy needs it)
- **Depends on:** T-231 (PR 230, merged; its deploy on 2026-11-06 met the refusal). The backlog row on start-up CPU (T-213) carries the history. Rafa approved this task on 2026-11-06: "Yes, do both" (this task and a scripted deploy check that another session builds).
- **Paths this task may touch:** `packages/core/src/parse.ts` and `parse.startup.test.ts`; `validators.ts`, `validators.generated.ts`, `validators-codegen.ts` and `validators.test.ts` (new), `packages/core/scripts/validators.ts` (new); `apps/demo-cloud/src/startup.test.ts` (new); `apps/demo-cloud/scripts/embed.mjs` (the embedded files); `eslint.config.js` (one ignore for the generated file); `docs/backlog.md` (the start-up CPU row); this file
- **Human gate:** no for this PR. The deploy that shows Cloudflare's own number waits for Rafa, as every deploy does.
- **Status:** review (branch `t-233-worker-startup`; Rafa's session reviews and merges)
- **Agent/session:** T-233 implementer session, 2026-11-06, worktree `.worktrees/t233-startup`, branch `t-233-worker-startup`; the T-230 build for comparison in `.worktrees/t233-old` (detached at `e5f667a`)

## Intent

Cloudflare refuses a Worker upload when its start-up, the module's global scope, takes more than 1 s of CPU (code 10021, "Script startup exceeded CPU time limit"). It refused holdback-op1 on 2026-11-03 and again on 2026-11-06 at T-231's deploy, and each retry of the same build passed. Cloudflare's own numbers for nearly the same code ranged from 394 ms to over 1,000 ms (measured, at the two deploys), so the margin is too thin to rely on a retry.

This task finds what the start-up spends its time on, removes the largest cost, and adds a CI check that keeps it out. It measures first: a CPU profile of the start-up of T-230's build (`e5f667a`) and of current main (`5cb8c25`), for both Workers. The fix moves the expensive work out of module load without changing what any request does. Today `packages/core/src/parse.ts` compiles every JSON Schema in `spec/schemas` twice with Ajv when it is imported (the signed and plain validator sets). This task compiles them ahead of time into a checked-in module of Ajv standalone code, so the Worker loads plain functions instead of generating them. The target is a local start-up well below both builds, and under 400 ms in Cloudflare's own measurement at the next deploy, which leaves 60% of the 1 s limit free.

**Non-goals.**
- Deploying or uploading anything. Cloudflare's number arrives only with a real upload, which waits for Rafa.
- Any change to what the parsers accept or refuse, to the API, to `spec/schemas` or to the contract.
- The scripted deploy check (another session builds it) and the read-after-write audit (T-232, another session, in `apps/demo-cloud/src`).
- Start-up costs outside the schema compilation, unless the profile shows another one worth more than about 20 ms.
- `docs/plan.md` and `docs/log/`, which another session owns today.

## Context

- Cloudflare's limit: https://developers.cloudflare.com/workers/platform/limits/#worker-startup-time. "A Worker must parse and execute its global scope (top-level code outside of handlers) within 1 second", on every plan; above it the upload fails with code 10021 (documented, read 2026-11-06). Parsing counts, not only execution. `npx wrangler@4 check startup` writes a CPU profile of the start-up, measured on the local machine.
- `docs/operations.md`, the T-231 deploy record: the refused upload at about 18:55 UTC, then 575 ms (holdback-op1) and 780 ms (holdback-op2) on the retry; T-230's deploy reported 394 ms and 397 ms.
- `docs/team.md`, Rules and checks, "Schemas compile at import, never in a request" (T-029): a Worker may generate code only at start-up. T-029's lazy compile took the live demo down with error 1101.
- `packages/core/src/parse.startup.test.ts`: every parser runs with `Function` disabled after import.
- The precedent for a checked-in generated file with a freshness test: `packages/settlement/evm/abis.json`, `scripts/evm-abis.mjs` and `abis.test.ts`.

## Acceptance criteria

1. [x] **Measured before.** The task's Evidence records the start-up profiles of `e5f667a` and `5cb8c25`, the top items of each in ms, and what changed between them.
2. [x] **No code generation at start-up.** In Node with `--disallow-code-generation-from-strings`, importing the built Worker module (`apps/demo-cloud/dist/worker.js`) succeeds, and every parser in core then runs on the spec examples. The test (`apps/demo-cloud/src/startup.test.ts`) fails on `5cb8c25`.
3. [x] **Same behaviour.** For every example in `spec/examples` and every mutation of it the test makes (each value removed, nulled, or swapped for a string, number, array or timestamp), the precompiled validators return the same result and the same error list as the runtime compile they replace, for the signed and the plain set.
4. [x] **The generated module stays current.** A test regenerates the module from `spec/schemas` and fails, with the command to run, when the checked-in file differs.
5. [x] **Faster start-up, measured locally.** `npx wrangler@4 check startup` runs the whole start-up of both Workers (before the change it stopped at the first schema compile), and the Node module evaluation of the bundle drops well below both builds. Evidence relates the local numbers to Cloudflare's (inferred).
6. [x] **The backlog row** on start-up CPU says it moved to T-233.
7. [x] **`pnpm verify` passes;** its step table is in Evidence.

## Out of scope

- A start-up time budget measured in CI: CI runners vary, so a timing check would be noisy. The code-generation check is deterministic.
- Reducing the bundle's other modules (viem, the operator), which the profile shows as small.

## Evidence

All local numbers come from a MacBook on 2026-11-06, Node 22.22.2 and wrangler 4.85.0. The bundles are `wrangler deploy --dry-run --outdir` output; nothing was uploaded.

**What changed between the two builds.** Almost nothing at start-up (measured):
- T-231's diff adds no global-scope work: `timeouts.ts` defines constants and functions, and the other files add methods.
- The bundle grew by 15.6 KiB, from 2,707.91 KiB (gzip 535.90 KiB) to 2,723.48 KiB (gzip 540.17 KiB).
- Node evaluates the two bundles in the same time (below).
- holdback-op1 and holdback-op2 get byte-identical bundles in each build (the same SHA-1). Cloudflare still reported 575 ms for one and 780 ms for the other, and refused the first upload of the same bytes. Its measurement of one bundle therefore varied by at least 205 ms, and probably by more than 425 ms (inferred). The rise from 394 ms to 575 ms and above came from that variance, not from T-231's code (inferred).

**What dominates the start-up.** Ajv's schema compile in `packages/core/src/parse.ts` takes about 90% of the bundle's global scope (measured, `node --cpu-prof --cpu-prof-interval=100` on an `import()` of the bundle; times include the profiler's overhead):

| Item (inclusive ms unless noted) | `e5f667a` | `5cb8c25` | after T-233 |
| --- | --- | --- | --- |
| The bundle's global scope (`worker.js:1`) | 293.2 | 294.9 | 21.2 |
| Ajv `compile` in core, both sets | 266.2 | 264.5 | none |
| of which `compileSchema` self time (the `new Function` call) | 39.1 | 35.0 | none |
| of which fast-uri, Ajv's `$ref` resolution (self) | 22.6 | 25.4 | none |
| V8 compiling the module source (`compileSourceTextModule`, self) | 33.1 | 36.0 | 36.4 |
| Garbage collection (self) | 22.2 | 19.6 | 2.1 |
| ox, @noble/hashes, viem, abitype (each, inclusive) | 3.2 to 4.6 | 3.5 to 5.3 | 2.8 to 5.0 |
| `schemaValidators`, building both sets (self) | n/a | n/a | 1.4 |
| Profile span | 404.2 | 408.4 | 110.5 |

**Start-up time, local** (measured):

| Measurement | `e5f667a` | `5cb8c25` | after T-233 |
| --- | --- | --- | --- |
| Node `import()` of the op1 bundle, wall time, median of 9 fresh processes (min to max) | 232 ms (228 to 277) | 241 ms (227 to 276) | 66 ms (65 to 73) |
| The same, CPU time of the whole Node process (all threads), median | 641 ms | 646 ms | 84 ms |
| `npx wrangler@4 check startup`, op1 profile span | 107.3 ms, stopped at the first schema compile | 103.0 ms, stopped at the first schema compile | 123.6 ms, whole start-up |
| `npx wrangler@4 check startup`, op2 profile span | 89.3 ms, stopped at the first schema compile | 113.7 ms, stopped at the first schema compile | 77.6 ms, whole start-up |
| Bundle size (gzip) | 2,707.91 KiB (535.90 KiB) | 2,723.48 KiB (540.17 KiB) | 4,007.02 KiB (618.55 KiB) |

- `wrangler check startup` could not profile either build before this change. The local runtime refused Ajv's `new Function` with "Error compiling schema", so each profile ends at the first compile (measured). After the change it runs the whole start-up with no error (measured). Its 33 to 56 samples per run are too few to compare runs closely.
- The bundle grows by 1,284 KiB (78 KiB gzipped): wrangler's bundler prints the 929 KiB generated module with indentation (measured). V8 parses it lazily, so compiling the module source stays at about 36 ms (measured, the profile table). Cloudflare caps only the uncompressed bundle, at 64 MiB on both plans, so 4,007 KiB is far under it (documented, Cloudflare's limits page, read 2026-11-06).

**How the local numbers relate to Cloudflare's** (inferred). Cloudflare measured 394 ms and 397 ms for `e5f667a`, whose Node evaluation takes 232 ms here: 1.7 times as long. For `5cb8c25` it measured 575 ms, 780 ms and over 1,000 ms against 241 ms here: 2.4 to more than 4.1 times as long. At those ratios the new start-up of 66 ms would measure about 112 ms to 271 ms on Cloudflare, under the 400 ms target even at the worst ratio seen. The ratios came from a start-up made mostly of Ajv's code generation; the new one is mostly script parsing, so treat the range as an estimate. Cloudflare's own number arrives with the next deploy.

**Commands run and results:**
- `apps/demo-cloud/src/startup.test.ts` on `5cb8c25` fails with `EvalError: Code generation from strings disallowed for this context`, thrown at `new Function` in Ajv's `compileSchema` (measured). After the change it passes (measured).
- `packages/core/src/validators.test.ts`: 14,319 cases per set, built from 34 examples (each example, 5 whole-value swaps, and 15 swaps of every value in it). The precompiled validators and the runtime compile agree on every case, for the result and the whole error list, in both sets (measured). More than half of the cases are refused, so the comparison covers the refusals (measured, the test's own check).
- The tests bite (measured): an edited header in `validators.generated.ts` fails the freshness test with "packages/core/src/validators.generated.ts is stale: run node packages/core/scripts/validators.ts". Giving the plain set the signed date-time fails the comparison, for example on `adjudicator.example.json /metrics/measuredAt = "2026-11-06T12:00:00.500Z"`.
- `node packages/core/scripts/validators.ts` writes the module: 18 schemas, 929 KiB, 29,486 lines (measured).
- `pnpm lint`: no findings (measured).
- gitleaks is not installed here. An approximation of its generic-api-key rule (entropy at least 3.5 bits) finds one candidate in the generated module, `key0 === "plaintextSha256"`. gitleaks allows a secret that contains a stop word, and "text" and "sha256" are both on its list, so it should not flag this line (inferred from gitleaks' `stopwords.go`). CI's gitleaks job passed on PR 240 (measured).
- CI on PR 240: every check passed, the required `check` and `gitleaks` included (measured).

**`pnpm verify`** on `057778c`, the branch rebased on `782724a`, at 22:20 UTC: PASS (measured, `reports/verify-t-233-worker-startup.md`). The "uncommitted changes" it notes are this file's last edits and the nested submodules `forge build` fetched into `contracts/lib/commerce-payments`.

| Step | Command | Status | Time |
| --- | --- | --- | --- |
| typecheck | `pnpm typecheck` | pass | 1028 ms |
| lint | `pnpm lint` | pass | 15936 ms |
| forge build | `forge build --root contracts` | pass | 2074 ms |
| forge | `forge test --root contracts` | pass | 110305 ms |
| test | `pnpm test` | pass | 492153 ms |
| spec | `pnpm validate:spec` | pass | 2729 ms |
| snap | `pnpm snap` | pass | 29454 ms |
| snap:local | `pnpm snap --settlement=local` | pass | 36065 ms |
| demo | `pnpm demo` | pass | 12597 ms |

Two earlier runs on the same code failed one step each, and neither failure involves this change (measured):
- The first run's `forge build` failed in 88 s while it cloned the nested submodules of `contracts/lib/commerce-payments`, which a new worktree lacks. `forge test` then passed, and `forge build` passed alone. Every other step passed, `pnpm test` included.
- The second run's `pnpm test` timed out in `apps/demo/src/transcript/untrusted.test.ts` at a load average of 165, with other sessions' runs on the same machine. A later `pnpm test` failed once in `examples/e2e-scenarios-scripted.test.ts` (scenario 7, "made no decision"). Both files pass alone: 7 of 7 and 4 of 4 tests.

**Snapshot diffs:** none against HEAD (the verify report).

## Decisions

1. **Compile ahead of time, not lazily.** A Worker may not generate code inside a request (T-029: a lazy compile took the demo down with error 1101). A lazy import would still compile in a request. Ajv's standalone code is the source Ajv used to pass to `new Function` at start-up, written to a file instead.
2. **Check the generated module in, with a freshness test**, as `packages/settlement/evm/abis.json` does. Tests, typecheck, the Node demo and the Worker then run the same file with no extra build step, and a fresh clone needs no script before `tsc -b`. The cost is a 929 KiB file in git, rewritten by `node packages/core/scripts/validators.ts` after each schema change or Ajv upgrade.
3. **One code body for both sets.** The generated function takes the formats as a parameter, and `validators.ts` calls it once per set. Two copies would take about 1.8 MiB. The code calls `uri` as a function and `date-time` through `validate`, so the signed set now passes `{ type: 'string', validate: signedTimestamp }` where it passed the bare function. Ajv runs the same check for both forms (strings only), and the comparison test confirms it.
4. **The same Ajv options as before** (strict, `allErrors` off, `validateSchema` off, the optimizer off), plus `lines` for readable diffs. Turning the optimizer on would shrink the file by about 8%, but would no longer be the code the old compile ran.
5. **A deterministic guard, not a time budget.** CI runners vary, so a start-up time budget would be noisy. A child Node process with `--disallow-code-generation-from-strings` fails on any code generation at import, from Ajv or any other library. `wrangler check startup` would be closer to Cloudflare, but it needs wrangler from npm and a bundle, and CI's test job has neither.
6. **The Worker no longer embeds `spec/schemas`.** `parse.ts` was the only runtime reader (`grep` of the Worker's packages for `readFileSync`, `readdirSync` and `spec/schemas`), so `embed.mjs` drops 18 files, 122,690 bytes of JSON.
7. **Ajv's runtime helpers are read either way.** `ajv/dist/runtime/equal.js` and `ucs2length.js` are CommonJS. Node and wrangler's bundler hand an import the whole module, and Vitest hands it the function, so the generated module takes `.default` when it exists and the import itself otherwise.

## Handoff

**Done:** the measurements above; core's validators compiled ahead of time; the code-generation guard and the comparison and freshness tests; the backlog row; `pnpm verify`.

**Not done, outside this task's paths** (proposed text, for the coordinator):
- `docs/team.md`, Rules and checks, the T-029 row "Schemas compile at import, never in a request" now names the wrong check. Proposed row: "| No code generation in a Worker, at start-up or in a request | `apps/demo-cloud/src/startup.test.ts` imports the built Worker in Node with `--disallow-code-generation-from-strings` and runs every parser; `packages/core/src/validators.test.ts` keeps the precompiled validators current and equal to a runtime compile. Added after T-029's lazy compile took the demo down with error 1101, and Cloudflare refused two uploads on start-up CPU (code 10021, 2026-11-03 and 2026-11-06) | T-029; T-233 |".
- `docs/operations.md`, line 72, "compile schemas at startup, not lazily inside a request". Proposed: "generate no code: core's validators are compiled ahead of time (T-233); a compile at startup costs start-up CPU (code 10021), and one inside a request fails (error 1101)".

**Waiting on Rafa:** the next operator deploy, which reports Cloudflare's own start-up time. The deploy record should note it against the 400 ms target.

**How to resume:** after any change to `spec/schemas` or to Ajv's version, run `node packages/core/scripts/validators.ts` and commit the regenerated `packages/core/src/validators.generated.ts`. `validators.test.ts` fails until then.

**Open questions:**
- gitleaks passed on PR 240. If a later schema change makes it flag a line in the generated module, rename Ajv's loop variables (`keyN`) in `validators-codegen.ts`'s post-processing, matching only the names Ajv declares in `for (const keyN in …)`.
- The start-up guard reads `apps/demo-cloud/dist`, so a local `pnpm test` without a build checks the last build. CI and `pnpm verify` build first.
